import { Mutex } from 'async-mutex';
import fetch, { Headers, Request, RequestInfo, RequestInit, Response } from 'node-fetch';
import { URL } from 'url';

const hostRegex = /^((http[s]?|ftp):\/)?\/?([^:\/\s]+)((\/\w+)*\/)([\w\-\.]+[^#?\s]+)?(.*)?(#[\w\-]+)?$/;
const cookiesRegex = /([0-9a-zA-Z\-_]+)=([^;]+); (?:(?:(expires)=([^;]+))|(?:Max-Age=([0-9]+))|(?:(path)=([^;]+))|(httponly)?(?:; )?){0,4}/gim;

export class Cookie {
    public name: string;
    public value: string;

    constructor(name: string, value: string) {
        this.name = name;
        this.value = value;
    }

    toString(): string {
        return `${this.name}=${this.value}`;
    }
}

export class Cookies {
    private cookies: Cookie[] = [];

    static parse(rawCookies: string): Cookies {
        const cs = new Cookies();

        let result = cookiesRegex.exec(rawCookies);
        while (result !== null) {
            const [, name, value] = result;
            cs.set(name, value);
            result = cookiesRegex.exec(rawCookies);
        }
        return cs;
    }

    toString(): string {
        const out = this.cookies.map((c) => c.toString()).join('; ');
        return out;
    }

    merge(cookies: Cookies): void {
        cookies.cookies.forEach((c) => this.set(c.name, c.value));
    }

    set(name: string, value: string): void {
        const prevC = this.cookies.find((c) => c.name === name); // TODO: This is replacing a cookie that may not be needed to be replaced (https://stackoverflow.com/a/4327214/3479519)
        if (prevC) prevC.value = value;
        else this.cookies.push(new Cookie(name, value));
    }

    get(name: string): Cookie[] {
        return this.cookies.filter((c) => c.name === name);
    }
}

export class CookieJar {
    private jars: { [key: string]: Cookies } = {};

    get(host: string): Cookies | undefined {
        return this.jars[host];
    }

    set(host: string, cookies: Cookies): void {
        this.jars[host] = cookies;
    }
}

export class Session {
    public cookieJar: CookieJar = new CookieJar();
    public headers: Headers;
    public delay: number;
    public maxRetries: number;
    public log: boolean;
    private lastRequestAt: number;
    private mutex: Mutex;
    private queueLength = 0;

    constructor({ headers, delay, maxRetries, log }: { headers?: Headers; delay?: number; maxRetries?: number; log?: boolean } = {}) {
        this.headers = new Headers(headers ?? {});
        this.delay = delay ?? 0;
        this.maxRetries = maxRetries ?? 0;
        this.lastRequestAt = 0;
        this.log = log ?? true;
        this.mutex = new Mutex();
    }

    public async fetch(input: RequestInfo, init?: RequestInit | undefined, { retryCount = 0 }: { retryCount?: number } = { retryCount: 0 }): Promise<Response> {
        const release = await this.mutex.acquire();
        const now = new Date().getTime();
        const delay = Math.max(0, this.delay - (now - this.lastRequestAt)) * 2 ** retryCount;
        this.lastRequestAt = now + delay;
        release();
        this.queueLength += 1;
        return new Promise((res, rej) =>
            setTimeout(async () => {
                this.queueLength -= 1;
                if (this.log) console.debug(`New request: ${new Date()} Queue: ${this.queueLength}`);
                const req = this._fetch(input, init);
                try {
                    res(await req);
                } catch (err) {
                    console.error('Retry:', retryCount, 'URL:', input, 'Error:', err);
                    if (retryCount === this.maxRetries) rej(err);
                    else res(this.fetch(input, init, { retryCount: retryCount + 1 }));
                }
            }, delay)
        );
    }

    private async _fetch(input: RequestInfo, init?: RequestInit | undefined): Promise<Response> {
        let host: string;

        if (input instanceof Request) host = hostRegex.exec(input.url)![3];
        else if (input instanceof URL) host = input.host;
        else host = hostRegex.exec(input as string)![3];

        const previousCookies = this.cookieJar.get(host);
        const hostJar = new Cookies();
        if (previousCookies) hostJar.merge(previousCookies);

        if (init) {
            if (init.headers) {
                if (init.headers instanceof Headers) {
                    this.headers.forEach((v, k) => (init?.headers as Headers).set(k, v));
                    const currentCookies = init.headers.get('cookie');
                    if (currentCookies) hostJar.merge(Cookies.parse(currentCookies));
                    init.headers.set('cookie', hostJar.toString());
                } else if (Array.isArray(init.headers)) {
                    this.headers.forEach((v, k) => (init?.headers as string[][]).push([k, v]));
                    init.headers.find(([k, v], i) => {
                        if (k === 'cookie') {
                            hostJar.merge(Cookies.parse(v));
                            (init!.headers as string[][])[i]![1] = hostJar.toString();
                        }
                    });
                } else {
                    this.headers.forEach((v, k) => ((init?.headers as Record<string, string>)[k] = v));
                    if (init.headers.cookie) hostJar.merge(Cookies.parse(init.headers.cookie));
                    init.headers.cookie = hostJar.toString();
                }
            } else {
                init.headers = new Headers();
                this.headers.forEach((v, k) => (init?.headers as Headers).set(k, v));
                const currentCookies = init.headers.get('cookie');
                if (currentCookies) hostJar.merge(Cookies.parse(currentCookies));
                init.headers.set('cookie', hostJar.toString());
            }
        } else {
            if (input instanceof Request) {
                const cookies = input.headers.get('cookie');
                if (cookies) hostJar.merge(Cookies.parse(cookies));
                this.headers.forEach((v, k) => (input as Request).headers.set(k, v));
                input.headers.set('cookies', hostJar.toString());
            } else if (typeof input === 'string') {
                const headers = new Headers();
                headers.set('cookie', hostJar.toString());
                this.headers.forEach((v, k) => headers.set(k, v));
                init = { headers };
            } else if (input instanceof URL) {
                const headers = new Headers();
                headers.set('cookie', hostJar.toString());
                this.headers.forEach((v, k) => headers.set(k, v));
                input = { url: input.toString(), headers } as Request;
            }
        }

        const response = await fetch(input, init);

        const receivedCookiesRaw = response.headers.get('set-cookie');
        if (receivedCookiesRaw) {
            const newCookies = Cookies.parse(receivedCookiesRaw);
            if (previousCookies) newCookies.merge(previousCookies);
            this.cookieJar.set(host, newCookies);
        }

        return response;
    }
}
