import { Headers, RequestInfo, RequestInit, Response } from 'node-fetch';
export declare class Cookie {
    name: string;
    value: string;
    constructor(name: string, value: string);
    toString(): string;
}
export declare class Cookies {
    private cookies;
    static parse(rawCookies: string): Cookies;
    toString(): string;
    merge(cookies: Cookies): void;
    set(name: string, value: string): void;
    get(name: string): Cookie[];
}
export declare class CookieJar {
    private jars;
    get(host: string): Cookies | undefined;
    set(host: string, cookies: Cookies): void;
}
export declare class Session {
    cookieJar: CookieJar;
    headers: Headers;
    delay: number;
    maxRetries: number;
    log: boolean;
    private lastRequestAt;
    private mutex;
    private queueLength;
    constructor({ headers, delay, maxRetries, log }?: {
        headers?: Headers;
        delay?: number;
        maxRetries?: number;
        log?: boolean;
    });
    fetch(input: RequestInfo, init?: RequestInit | undefined, { retryCount }?: {
        retryCount?: number;
    }): Promise<Response>;
    private _fetch;
}
