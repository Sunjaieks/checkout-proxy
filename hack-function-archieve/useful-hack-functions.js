/**
 * This function overwrites the Set-Cookie header in the response headers.
 *
 * @returns {function(requestOptions, originalResponse): modifiedResponse}
 * @param newCookies array of cookies. for example: ['cookie1=0000', 'cookie2=0001']
 * Give ['cookie1='] will remove Set-Cookie for cookie 'cookie1'
 * Give ['cookie1=0000'] will overwrite Set-Cookie header for 'cookie1'
 */
const overwriteCookiesInResponseHeaders = (newCookies) => (requestOptions, originalResponse) => {
    if (!requestOptions.method || requestOptions.method.toUpperCase() === 'OPTIONS') return originalResponse;
    const headers = originalResponse.headers;
    const setCookieKey =
        Object.keys(originalResponse.headers).find((key) => key.toLowerCase() === 'set-cookie') || 'Set-Cookie';
    let cookieArray = headers[setCookieKey]
        ? Array.isArray(headers[setCookieKey])
            ? [...headers[setCookieKey]]
            : [headers[setCookieKey]]
        : [];
    (newCookies || []).forEach((cookie) => {
        if (!cookie) return;
        const [key, value] = cookie.split('=');
        const regex = new RegExp(value && value.includes(';') ? `^\\s*(${key}=)(.*)$` : `^\\s*(${key}=)([^;]*)`);
        for (let i = cookieArray.length - 1; i >= 0; i--) {
            const oldCookie = cookieArray[i];
            if (regex.test(oldCookie)) {
                if (value) {
                    cookieArray[i] = oldCookie.replace(regex, `$1${value}`);
                } else {
                    cookieArray.splice(i, 1);
                }
                break;
            }
        }
    });
    originalResponse.headers[setCookieKey] = cookieArray;
    return originalResponse;
};

/**
 * This function overwrites the Cookie header in request headers.
 * @returns {function(requestOptions): modifiedRequestOptions}
 * @param newCookies array of cookies. for example: ['cookie1=0000', 'cookie2=0001']
 * Give ['cookie1='] will remove cookie1 in Cookie header
 * Give ['cookie1=0000'] will overwrite the value of 'cookie1' in Cookie header,
 * or add 'cookie1=0000' in Cookie header in case 'cookie1' is not exist
 */
const overwriteCookiesInRequestHeaders = (newCookies) => (requestOptions) => {
    if (!requestOptions.method || requestOptions.method.toUpperCase() === 'OPTIONS') return requestOptions;
    const cookieKey = Object.keys(requestOptions.headers).find((key) => key.toLowerCase() === 'cookie') || 'Cookie';
    (newCookies || []).forEach((cookie) => {
        if (!cookie) return;
        const [key, value] = cookie.split('=');
        const regex = new RegExp(`(^|;\\s*)${key}=[^;]*`);
        if (requestOptions.headers[cookieKey]) {
            if (regex.test(requestOptions.headers[cookieKey])) {
                requestOptions.headers[cookieKey] = requestOptions.headers[cookieKey].replace(
                    regex,
                    value ? `$1${cookie}` : ''
                );
            } else if (value) {
                requestOptions.headers[cookieKey] = `${requestOptions.headers[cookieKey]}; ${cookie}`;
            }
        } else if (value) {
            requestOptions.headers[cookieKey] = cookie;
        }
    });
    return requestOptions;
};

/**
 * This function is for specifying proxy, target and path-prefix rewrite for designated path.
 * @returns {function(requestOptions): modifiedRequestOptions}
 * @param pathConfigMap object of path to config map. for example: {'/path1':{target:'https://a.com:443', proxyUrl:'http://proxy1.com:9300', path:'/path1/path2'}, '/path2':{path:'/'}}
 * @param defaultConfig a fallback config (only 'target'/'proxyUrl' apply; its 'path' is ignored since there is no matched prefix to replace). for example: {proxyUrl:'http://proxy3.com:9300'}
 * Give a config with 'target' to change the destination (also updates the Host header) but keep the current proxy; any path in 'target' is ignored
 * Give a config with 'path' to rewrite the matching path prefix (the first matching prefix is replaced)
 * Give a config with 'proxyUrl' to change the proxy but keep the current target; proxyUrl:null clears the proxy for that path
 * Example for hackRequest: overwriteRuleForPath({'/path1':{target:'https://a.com:443','proxyUrl':'http://proxy1.com:9300','path':'/path1/path2'}})
 */
const overwriteRuleForPath = (pathConfigMap, defaultConfig) => (requestOptions) => {
    let tempPath = requestOptions.path || '/';
    if (!tempPath.startsWith('/')) {
        tempPath = '/' + tempPath;
    }
    const entry = Object.entries(pathConfigMap).find(([key]) => tempPath.startsWith(key));
    const config = entry ? entry[1] : defaultConfig;
    if (entry && config && config.path != null) {
        requestOptions.path = tempPath.replace(entry[0], config.path);
    }
    if (config && config.target) {
        const targetUrl = new URL(config.target);
        requestOptions.protocol = targetUrl.protocol.slice(0, -1);
        requestOptions.hostname = targetUrl.hostname;
        requestOptions.port = targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80');
        const isDefaultPort =
            requestOptions.protocol === 'https' ? requestOptions.port === '443' : requestOptions.port === '80';
        requestOptions.headers.host = requestOptions.hostname + (isDefaultPort ? '' : ':' + requestOptions.port);
    }
    if (config && 'proxyUrl' in config) {
        requestOptions.proxyUrl = config.proxyUrl;
    }
    return requestOptions;
};

// ----- Generated By Tool -----
const stringifiedFunctions = {
  "overwriteCookiesInResponseHeaders": "(newCookies=>(requestOptions,originalResponse)=>{if(!requestOptions.method||requestOptions.method.toUpperCase()==='OPTIONS')return originalResponse\nconst headers=originalResponse.headers\nconst setCookieKey=Object.keys(originalResponse.headers).find(key=>key.toLowerCase()==='set-cookie')||'Set-Cookie'\nlet cookieArray=headers[setCookieKey]?Array.isArray(headers[setCookieKey])?[...headers[setCookieKey]]:[headers[setCookieKey]]:[];(newCookies||[]).forEach(cookie=>{if(!cookie)return\nconst[key,value]=cookie.split('=')\nconst regex=new RegExp(value&&value.includes(';')?`^\\\\s*(${key}=)(.*)$`:`^\\\\s*(${key}=)([^;]*)`)\nfor(let i=cookieArray.length-1;i>=0;i--){const oldCookie=cookieArray[i]\nif(regex.test(oldCookie)){if(value){cookieArray[i]=oldCookie.replace(regex,`$1${value}`)}else{cookieArray.splice(i,1)}break}}})\noriginalResponse.headers[setCookieKey]=cookieArray\nreturn originalResponse}\n)",
  "overwriteCookiesInRequestHeaders": "(newCookies=>requestOptions=>{if(!requestOptions.method||requestOptions.method.toUpperCase()==='OPTIONS')return requestOptions\nconst cookieKey=Object.keys(requestOptions.headers).find(key=>key.toLowerCase()==='cookie')||'Cookie';(newCookies||[]).forEach(cookie=>{if(!cookie)return\nconst[key,value]=cookie.split('=')\nconst regex=new RegExp(`(^|;\\\\s*)${key}=[^;]*`)\nif(requestOptions.headers[cookieKey]){if(regex.test(requestOptions.headers[cookieKey])){requestOptions.headers[cookieKey]=requestOptions.headers[cookieKey].replace(regex,value?`$1${cookie}`:'')}else if(value){requestOptions.headers[cookieKey]=`${requestOptions.headers[cookieKey]}; ${cookie}`}}else if(value){requestOptions.headers[cookieKey]=cookie}})\nreturn requestOptions}\n)",
  "overwriteRuleForPath": "((pathConfigMap,defaultConfig)=>requestOptions=>{let tempPath=requestOptions.path||'/'\nif(!tempPath.startsWith('/')){tempPath='/'+tempPath}const entry=Object.entries(pathConfigMap).find(([key])=>tempPath.startsWith(key))\nconst config=entry?entry[1]:defaultConfig\nif(entry&&config&&config.path!=null){requestOptions.path=tempPath.replace(entry[0],config.path)}if(config&&config.target){const targetUrl=new URL(config.target)\nrequestOptions.protocol=targetUrl.protocol.slice(0,-1)\nrequestOptions.hostname=targetUrl.hostname\nrequestOptions.port=targetUrl.port||(targetUrl.protocol==='https:'?'443':'80')\nconst isDefaultPort=requestOptions.protocol==='https'?requestOptions.port==='443':requestOptions.port==='80'\nrequestOptions.headers.host=requestOptions.hostname+(isDefaultPort?'':':'+requestOptions.port)}if(config&&'proxyUrl'in config){requestOptions.proxyUrl=config.proxyUrl}return requestOptions}\n)"
};
