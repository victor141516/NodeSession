"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = exports.CookieJar = exports.Cookies = exports.Cookie = void 0;
const async_mutex_1 = require("async-mutex");
const node_fetch_1 = __importStar(require("node-fetch"));
const url_1 = require("url");
const hostRegex = /^((http[s]?|ftp):\/)?\/?([^:\/\s]+)((\/\w+)*\/)([\w\-\.]+[^#?\s]+)?(.*)?(#[\w\-]+)?$/;
const cookiesRegex = /([0-9a-zA-Z\-_\.]+)=([^;]+); (?:(?:(expires)=([^;]+))|(?:Max-Age=([0-9]+))|(?:(path)=([^;]+))|(httponly)?(?:; )?){0,4}/gim;
class Cookie {
    constructor(name, value) {
        this.name = name;
        this.value = value;
    }
    toString() {
        return `${this.name}=${this.value}`;
    }
}
exports.Cookie = Cookie;
class Cookies {
    constructor() {
        this.cookies = [];
    }
    static parse(rawCookies) {
        const cs = new Cookies();
        let result = cookiesRegex.exec(rawCookies);
        while (result !== null) {
            const [, name, value] = result;
            cs.set(name, value);
            result = cookiesRegex.exec(rawCookies);
        }
        return cs;
    }
    toString() {
        const out = this.cookies.map((c) => c.toString()).join('; ');
        return out;
    }
    merge(cookies) {
        cookies.cookies.forEach((c) => this.set(c.name, c.value));
    }
    set(name, value) {
        const prevC = this.cookies.find((c) => c.name === name); // TODO: This is replacing a cookie that may not be needed to be replaced (https://stackoverflow.com/a/4327214/3479519)
        if (prevC)
            prevC.value = value;
        else
            this.cookies.push(new Cookie(name, value));
    }
    get(name) {
        return this.cookies.filter((c) => c.name === name);
    }
}
exports.Cookies = Cookies;
class CookieJar {
    constructor() {
        this.jars = {};
    }
    get(host) {
        return this.jars[host];
    }
    set(host, cookies) {
        this.jars[host] = cookies;
    }
}
exports.CookieJar = CookieJar;
class Session {
    constructor({ headers, delay, maxRetries, log } = {}) {
        this.cookieJar = new CookieJar();
        this.queueLength = 0;
        this.headers = new node_fetch_1.Headers(headers !== null && headers !== void 0 ? headers : {});
        this.delay = delay !== null && delay !== void 0 ? delay : 0;
        this.maxRetries = maxRetries !== null && maxRetries !== void 0 ? maxRetries : 0;
        this.lastRequestAt = 0;
        this.log = log !== null && log !== void 0 ? log : true;
        this.mutex = new async_mutex_1.Mutex();
    }
    async fetch(input, init, { retryCount = 0 } = { retryCount: 0 }) {
        const release = await this.mutex.acquire();
        const now = new Date().getTime();
        const delay = Math.max(0, this.delay - (now - this.lastRequestAt)) * 2 ** retryCount;
        this.lastRequestAt = now + delay;
        release();
        this.queueLength += 1;
        return new Promise((res, rej) => setTimeout(async () => {
            this.queueLength -= 1;
            if (this.log)
                console.debug(`New request: ${new Date()} Queue: ${this.queueLength}`);
            const req = this._fetch(input, init);
            try {
                res(await req);
            }
            catch (err) {
                console.error('Retry:', retryCount, 'URL:', input, 'Error:', err);
                if (retryCount === this.maxRetries)
                    rej(err);
                else
                    res(this.fetch(input, init, { retryCount: retryCount + 1 }));
            }
        }, delay));
    }
    async _fetch(input, init) {
        let host;
        if (input instanceof node_fetch_1.Request)
            host = hostRegex.exec(input.url)[3];
        else if (input instanceof url_1.URL)
            host = input.host;
        else
            host = hostRegex.exec(input)[3];
        const previousCookies = this.cookieJar.get(host);
        const hostJar = new Cookies();
        if (previousCookies)
            hostJar.merge(previousCookies);
        if (init) {
            if (init.headers) {
                if (init.headers instanceof node_fetch_1.Headers) {
                    this.headers.forEach((v, k) => (init === null || init === void 0 ? void 0 : init.headers).set(k, v));
                    const currentCookies = init.headers.get('cookie');
                    if (currentCookies)
                        hostJar.merge(Cookies.parse(currentCookies));
                    init.headers.set('cookie', hostJar.toString());
                }
                else if (Array.isArray(init.headers)) {
                    this.headers.forEach((v, k) => (init === null || init === void 0 ? void 0 : init.headers).push([k, v]));
                    init.headers.find(([k, v], i) => {
                        if (k === 'cookie') {
                            hostJar.merge(Cookies.parse(v));
                            init.headers[i][1] = hostJar.toString();
                        }
                    });
                }
                else {
                    this.headers.forEach((v, k) => ((init === null || init === void 0 ? void 0 : init.headers)[k] = v));
                    if (init.headers.cookie)
                        hostJar.merge(Cookies.parse(init.headers.cookie));
                    init.headers.cookie = hostJar.toString();
                }
            }
            else {
                init.headers = new node_fetch_1.Headers();
                this.headers.forEach((v, k) => (init === null || init === void 0 ? void 0 : init.headers).set(k, v));
                const currentCookies = init.headers.get('cookie');
                if (currentCookies)
                    hostJar.merge(Cookies.parse(currentCookies));
                init.headers.set('cookie', hostJar.toString());
            }
        }
        else {
            if (input instanceof node_fetch_1.Request) {
                const cookies = input.headers.get('cookie');
                if (cookies)
                    hostJar.merge(Cookies.parse(cookies));
                this.headers.forEach((v, k) => input.headers.set(k, v));
                input.headers.set('cookies', hostJar.toString());
            }
            else if (typeof input === 'string') {
                const headers = new node_fetch_1.Headers();
                headers.set('cookie', hostJar.toString());
                this.headers.forEach((v, k) => headers.set(k, v));
                init = { headers };
            }
            else if (input instanceof url_1.URL) {
                const headers = new node_fetch_1.Headers();
                headers.set('cookie', hostJar.toString());
                this.headers.forEach((v, k) => headers.set(k, v));
                input = { url: input.toString(), headers };
            }
        }
        const response = await node_fetch_1.default(input, init);
        const receivedCookiesRaw = response.headers.get('set-cookie');
        if (receivedCookiesRaw) {
            const newCookies = Cookies.parse(receivedCookiesRaw);
            if (previousCookies)
                newCookies.merge(previousCookies);
            this.cookieJar.set(host, newCookies);
        }
        return response;
    }
}
exports.Session = Session;
//# sourceMappingURL=index.js.map