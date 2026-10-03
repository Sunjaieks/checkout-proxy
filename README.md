# Checkout-Proxy User Guide

## Introduction

Checkout-Proxy is a powerful local proxy application designed for web development and testing. 🚀
It enables you to intercept, inspect, and modify HTTP/HTTPS traffic with ease, focusing on flexible routing and quick UI tools for daily debugging.

### ✨ Key Features

*   🔐 **On-the-fly SSL Certificate Generation**: Dynamically generates SSL certificates for each requested domain, allowing your browser to establish secure connections.
*   🧩 **Flexible Configuration**: Profile-based configuration system with support for global profiles and reusable rule sets.
*   🔁 **HTTP/HTTPS Interoperability**: Support for proxying HTTPS requests to HTTP targets and vice versa.
*   🛠️ **Custom Hack Functions**: Define JavaScript functions to modify requests and responses on the fly for advanced scenarios (e.g., cookie manipulation, dynamic routing).
*   🌐 **Wildcard Domain Matching**: Support for `*` wildcards in domain names and ports for broad rule coverage.
*   ✍️ **Built-in Editor**: Integrated JSON and JavaScript editor with syntax highlighting and error checking.
*   🧭 **System Proxy Control**: Easily toggle OS-level proxy settings for Safari, simulators, and mobile devices.
*   🧾 **Request Console**: A live dashboard to monitor and filter proxied traffic.
*   🔗 **Utility Tools**: Built-in tools for URL encoding/decoding and MD5 hashing.
*   🧪 **Advanced Options**: Bypass-CORS and Keep-Host-Header support for complex debugging scenarios.
*   🏷️ **Optional Trace Headers**: Append `checkout-proxy-use-agent` to responses to track proxy routing.

## Install the Application 🧰
1.  **Download the Application:**
    *   Download the latest release. Choose the appropriate version for your operating system:
        *   **macOS:** `Checkout-Proxy-1.X.X-arm64.dmg`
        *   **Windows:** `Checkout-Proxy-1.X.X-x64.exe`

2.  **Install the Application:**
    *   **macOS:** Open the downloaded `.dmg` file and drag the `Checkout-Proxy.app` to the Applications folder. Before you start the application for the first time, you need to run the following command in terminal: `sudo xattr -r -d com.apple.quarantine /Applications/CheckoutProxy.app` and enter your password when prompted. That's because I am not a registered Apple developer, macOS will block the application from running.
    *   **Windows:** execute `.exe` install file and follow the installation instructions. You may need to allow the application through your firewall when you start a profile of Checkout Proxy for the first time.

## Before Using ✅
1.  **Create and Trust Root CA:**
    *   click [More]->[Create and Trust new CA] in main window and follow the step to ask system to trust new CA certificate. OS may ask you for password or confirmation.
        *   if you didn't trust new CA certificate by OS prompt, you can redo [More]->[Create and Trust new CA]
        *   or download it by [More]->[Download CA certificate], this way command will be copied and you can just run it by Mac's command line tool or Windows' powershell.
    *   (OPTIONAL) in case you want to add CA certificate by yourself after download. Here is how to Import `checkout-proxy-rootCA.crt` into your OS and trust it:
        *   **macOS:** Open any command line tool. 
            * execute `security delete-certificate -c "www.checkoutproxy.com(self-signed)" ~/Library/Keychains/login.keychain-db 2> /dev/null` to remove old CA certificate
            * execute `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ~/pathOfYourCert/checkout-proxy-rootCA.crt` (replace `~/pathOfYourCert/` with the actual path to the certificate) to add new one.
            * or you can import the certificate by OS UI:
                *   Open `Keychain Access` application. From MacOS15, Apple moved `Keychain Access` from `/System/Applications/Utilities/Keychain\ Access.app` to another place, you can open it by executing `open /System/Library/CoreServices/Applications/Keychain\ Access.app` in command line tool.
                *   Drag and drop `checkout-proxy-rootCA.crt` into the `login` keychain.
                *   Find the certificate in the list, double-click it.
                *   Expand the `Trust` section, set `When using this certificate` to `Always Trust`, and close the dialog.
        *   **Windows:**  Open PowerShell(admin).
            * execute `Get-ChildItem Cert: -Recurse | Where-Object {$_.Subject -match "www.checkoutproxy.com(self-signed)"} | Remove-Item 2>$null` to remove old CA certificate
            * execute `certutil.exe -addstore -f "Root" "${downloadPath}` (replace `${downloadPath}` with the actual path to the certificate) to add new one.
            * or you can import the certificate by OS UI:
                * double click `checkout-proxy-rootCA.crt` you downloaded --> click `Install Certificate` --> click `Next` --> select `Place all certificates in the following store` --> click `Browse...` --> select `Trusted Root Certification Authorities` --> click `OK` --> click `Next` --> click `Finish`. You may need to restart your browser.

2.  **Connect to Checkout-Proxy:**
    *   Configure your browser or system to use `127.0.0.1:18881` (replace `18881` if you've changed specified config of Checkout Proxy) as its HTTP proxy.
        *  it's recommended to use a browser extension like [FoxyProxy](https://addons.mozilla.org/en-US/firefox/addon/foxyproxy-standard/) or [SwitchyOmega](https://chromewebstore.google.com/detail/proxy-switchyomega-3-zero/pfnededegaaopdmhkdmcofjmoldfiped?pli=1).
    *   **Safari or mobile APP within IOS Simulator:** 
         1.  add root certificate for simulator by running the following command in terminal: `xcrun simctl keychain booted add-root-cert ~/Downloads/checkout-proxy-rootCA.crt` or just drag and drop the certificate into simulator, then open the certificate in simulator and trust it.
         2.  [Tools]->[Toggle System Proxy] to set system proxy for simulator(or you can set proxy by yourself in `System settings` -> `Wi-Fi` -> `Details` -> `Proxies` -> `Web Proxy (HTTP)` and `Secure Web Proxy (HTTPS)`).
         3.  if necessary, you can connect to VPN after setting system proxy
         4.  Now all the traffic from Safari or mobile APP within IOS Simulator will be proxied through Checkout Proxy, and you can inspect and modify the traffic in Checkout Proxy's console.
         5.  if you find requests from Safari/App are not proxied, you can try to toggle system proxy on and off again, or restart your PC/Mac and simulator.
    *   **Real device:**
         1.  Make sure your real device is in the same network with your PC/Mac which runs Checkout Proxy.
         2.  Get download link of CA by [More]->[Show Download Link of CA]->[Scan QR code], then you will be able to download CA certificate to your device. You have to trust it after downloading.
         3.  Set proxy for your real device to point to the IP address of your PC/Mac. IP and port should be same as the one shown in previous step when you click [More]->[Show Download Link of CA]. (For MacOS, you can also find the IP address by `System Preferences` -> `Network` -> select the network you are using -> find `IP address` (or by command `ipconfig getifaddr en0`). For Windows, you can find the IP address by executing `ipconfig` in command line tool and looking for the IPv4 address of the network you are using)
         4.  Now all the traffic from Safari or mobile APP within IOS Simulator will be proxied through Checkout Proxy, and you can inspect and modify the traffic in Checkout Proxy's console.
         5.  if you find requests from your real device are not proxied, you can try to stop your VPN of your Mac/PC
           
## Using the Application 🧭
1.  **Operation Manual:**
    *   **Top Buttons:**
        *   **More:** Opens the More Options menu:
            *   **Import Config** Load a configuration JSON file from your system.
            *   **Export Config** Save the current configuration to a file.
            *   **Open Help Window** Open this help document.
            *   **Create and Trust new CA** Generate a new Root CA and ask the OS to trust it.
            *   **Download CA Certificate** Download the current Root CA certificate and copy the install command to clipboard.
            *   **Clear App Cache** Clear HTTP cache, code cache, and dictionary cache.
            *   **Check for Update** Check whether a newer version is available.
        *   **Edit Config:** Opens a JSON editor to modify proxy rules and profiles. Click `Save and Close` to apply.
        *   **Tools:** Opens the Tools panel:
            *   **Encode and Decode** Open URL encode/decode, Unicode encode/decode, Base64 encode/decode, and MD5 utility window.
            *   **Toggle System Proxy** Toggle OS-level proxy settings (useful for Safari and iOS devices). Current state is shown below the button.
        *   **Console:** Open Request Console for live request logs.
        *   **Direct Connect:** Start the proxy server without any fixed routing rules or remote upstream proxy.
        *   **Stop:** Stop all running proxy servers (default port 18881).
    *   **Reset Options Button(in Config Editor):**
        *   **Reset text area to factory config:** Original Default Config is the configuration file shipped with this application. It will not be changed by any user operation.
        *   **Restore text area from backup:** User Default Config is the configuration saved by choosing "Save current text as User Default Config" button.
        *   **Backup current text area:** Click to save current text as User Default Config.
    *   **More Button (in Profile Editor):**
        *   **Save as new profile and Close:** Save current settings as a new profile.
        *   **Remove current profile:** Delete the active profile.

2.  **Request Console 🧾**
    *   **Live Traffic**: Real-time monitoring of all requests and responses passing through the proxy.
    *   **Interactive Table**: Support for column resizing, reordering, and visibility toggling per column.
    *   **Filtering**: Use the filter bar at the top. Syntax: `text` (global), `column:value` (scoped), `AND`/`OR`/`(…)` (logical). Values support regular expressions.
    *   **Entry Details**: Double-click any row to open the Entry Details panel:
        *   The **top pane** shows all request metadata (method, host, path, headers, status code, etc.) as formatted JSON.
        *   The **Request Body** pane and **Response Body** pane display the decoded body content.
            *   **Encoding modes**: Choose between Raw, UTF-8 URL Decode, EUC-JP URL Decode, and Unicode Decode.
            *   **Format JSON**: Toggle auto pretty-print; enabled automatically when `Content-Type` contains `json`.
            *   **Expand**: Click the expand icon (▶) on any body pane's header to maximise that pane; double-click the pane title to toggle.
            *   **Copy as cURL**: Click to copy the request as a complete `curl` command (includes all request headers, body, upstream proxy, and `--insecure`).
        *   Use `Cmd+F` / `Ctrl+F` to search inside any editor pane; `Esc` closes the search box, then the modal.
    *   **Recording**: Toggle logging via `recording: true` in `globalSettings.others`.

3.  **URL Tool 🔗**
    *   Quick access to URL encode/decode, Unicode encode/decode, Base64 encode/decode, and MD5 calculation.
    *   Supports multiple encodings, including `EUC-JP` (for URL and MD5 operations).
    *   **URL Encode/Decode**: Standard percent-encoding; options for `Space as +` and `Component only`.
    *   **Unicode Encode/Decode**: Converts characters to/from `\uXXXX` escape sequences.
    *   **Base64 Encode/Decode**: Standard Base64; `Component only` option strips padding if desired.

## Customize Configuration File 🧩

The configuration is a JSON object with a `profile` array:

```json
{
  // Version of the configuration file, this filed is used for informing you in case newer configuration format is released. you should not change this value.
  "configVersion": 1,
  "appPort": [ // you must specify two ports for this APP
    18881, // the first Port reserved for this APP, default is 18881, you should always use this port to access Checkout Proxy,
  ],
  // in case a profile having this field, APP will ask you to decide the value by showing a popup when you start this profile
  "toBeDecided": [
    "proxyPort=5801,5802"
  ],
  // unlike "toBeDecided", any placeholder holding the key of this field will be replaced by its value automatically when you start this profile
  "substitute": {
    "globalStgToolPort": "5702"
  },
  "profile": [
    {
      // give a name to the profile
      "name": "5702-default",
      "proxy": {
        "proxyUrl": "http://stg.proxy.com:5702", // specify the protocol, host, port for remote proxy. Both http and https proxies are supported.
        "globalProfile": [
          // specify the name of global profile you want to use in this profile, you can use multiple global profiles. The rules in globalProfile will be merged into this profile when you start this profile. Please refer to the `Global Profile` section for more details
          "prodTool",
          "others"
        ],
        "hostUsingProxy": [
          // specify the substring of the domain that you want to use remote proxy, priority : httpsFixedRule = httpFixedRule > hostBypassProxy > hostUsingProxy
          "*.aa.bb.com",
          "*.cc.dd.com",
          "*.resource.com"
        ],
        "hostBypassProxy": [
          // specify the substring of the domain which you don't want to use remote proxy, this has higher priority than `hostUsingProxy`
          "*.ee.ff.com"
        ],
        // this section is used for proxying HTTPS request to https/http target. All the rules in this section will not use remote proxy specified by proxy.proxyUrl, if you want to use secondary proxy server, you need to specify `customizedProxy` field for each rule
        "httpsFixedRule": {
          // specify the domain and port(can not omit) that you want to use fixed rule
          "map.specified.domain.com.for.https:443": {
            // specify the target protocol, domain and port. Both http and https targets are supported.
            "target": "https://mapped.specified.domain.com:443",
            // specify the secondary proxy server, if you don't want to use secondary proxy server, you can omit this field
            "customizedProxy": "http://specified.proxy.domain.com:5703",
            // if you want to keep the original host header, you can set this field to true, default is false, in most of the case you don't need to set this field
            "keepHostHeader": true,
            // if you want to bypass CORS restriction, you can set this field to true, default is false, it's experimental feature, you can use this feature only if you know what you are doing
            "bypassCors": true,
            "hackRequest": [
              // this field is used for modifying request  before sending request to target server, you can use multiple hacks, they will be executed in order. Please refer to the section of `Hack Function` for more details
              "overwriteCookiesInRequestHeaders(['Cc=ffff'])"
            ],
            "hackResponse": [
              // this field is used for modifying response before sending response to browser, you can use multiple hacks, they will be executed in order. Please refer to the section of `Hack Function` for more details
              "overwriteCookiesInResponseHeaders(['Dd=ffff'])"
            ]
          }
        },
        // this section is used for proxying HTTP request to https/http target. All the rules in this section will not use remote proxy specified by proxy.proxyUrl, if you want to use secondary proxy server, you need to specify `customizedProxy` field for each rule
        "httpFixedRule": {
          // specify the domain and port(can not omit) that you want to use fixed rule
          "map.specified.domain.com.for.http:8000": {
            // same as the field in httpsFixedRule
            "target": "http://mapped.specified.domain.com.for.http:8000",
            // same as the field in httpsFixedRule
            "customizedProxy": "http://specified.proxy.domain.com:5704",
            // same as the field in httpsFixedRule
            "keepHostHeader": true,
            // same as the field in httpsFixedRule
            "bypassCors": true,
            "hackRequest": [
              // same as the field in httpsFixedRule
              "overwriteCookiesInRequestHeaders(['Cc=ffff'])"
            ],
            "hackResponse": [
              // same as the field in httpsFixedRule
              "overwriteCookiesInResponseHeaders(['Dd=ffff'])"
            ]
          }
        }
      }
    },
    {
      "name": "another profile name",
      "proxy": {
        // same as first profile
      }
    }
  ],
  "globalSettings": {
    "others": {
      "addAgentHeader": true, // optional: add Checkout-Proxy-Use-Agent header in proxied responses
      "recording": true, // optional: whether requst will be recorded in console window
    },
    "substitute": { // same as the field in individual profile, but this field will be applied to all the individual profiles
      "globalStgProxyHost": "http://specified.global.proxy.domain.com:80"
    },
    // this section is used for defining some global profiles that can be used in any profile by specifying the name of the global profile in `proxy` field
    "profileSet": {
      "stgTool": { // name of the global profile
        "httpsFixedRule": { // same as the field in profile.proxy.httpsFixedRule
          "map.specified.domain.com.for.https": {
            "customizedProxy": "http://specified.proxy.domain.com:5704"
          }
        },
        "httpFixedRule": {} // same as the field in profile.proxy.httpFixedRule
      }
    }
  },
  // this section is used for defining how and which hack functions you want to use.
  // Please refer section of `Hack Function` for more details
  "reusableHackFunctions": {
    "overwriteCookiesInResponseHeaders": [
      // first element is reserved for saving comment of the function
      "",
      // second element is the function body
      "newCookies=>(requestOptions,originalResponse)=>{return originalResponse};"
    ],
    "overwriteCookiesInRequestHeaders": [
      "",
      "newCookies=>requestOptions=>{return requestOptions};"
    ]
  }
}
```

## Placeholder 🧷

You can use placeholder like `{{key}}` in the configuration file.
Placeholder in both individual profile and global profile will be decided and replaced by value of `substitute` and `toBeDecided`.
Both individual profile and config.globalSettings can have `substitute` field.

*   The value of the key defined in `tobeDecided` will be decided through a popup once you click `Start` button of a profile(Maximum 2 items are allowed in this field). As comparison, the value of each key defined in `substitute` is fixed.
*   Here is the priority of deciding the value of a placeholder:
`profileRoot.tobeDecided` > `profileRoot.substitute` > `globalSettings.substitute`
*   the value of `profileRoot.substitute` and `globalSettings.substitute` can use placeholder as well, but they can only be replaced by `profileRoot.tobeDecided`.

**Where can I use placeholders?** (same for `profileRoot.tobeDecided`, `profileRoot.substitute`, `globalSettings.substitute`):
*   value of `profileRoot.proxy.proxyUrl`
*   value of `profileRoot.proxy.hostUsingProxy` and `profileRoot.proxy.hostBypassProxy`
*   all the keys in the `http(s)FixedRule`
*   value of `http(s)FixedRule.target`
*   value of `http(s)FixedRule.customizedProxy`
*   value of `http(s)FixedRule.bypassCors` (after replacing, empty string means false, any other value means true)
*   value of `http(s)FixedRule.keepHostHeader` (after replacing, empty string means false, any other value means true)
*   item of `hackRequest` array and `hackResponse` array in `http(s)FixedRule`
*   item of `globalProfile` array
*   *value of `profileRoot.substitute` can only be replaced by `profileRoot.tobeDecided`
*   *value of `globalSettings.substitute` can only be replaced by `profileRoot.tobeDecided`

## Wildcard Matching ✨

You can use wildcard `*` at the beginning or the end of the key in `http(s)FixedRule` or the item of `hostUsingProxy` and `hostBypassProxy`.

## Global Settings 🌍

1.  **How does the key of http(s)FixedRule decided by Default port, Wildcard and Placeholder :**
    *   when you start a profile, placeholder in the value of `profileRoot.substitute` and `globalSettings.substitute` will be replaced by `profileRoot.toBeDecided` firstly
    *   then, the placeholder in the key of http(s)FixedRule will be replaced by defined `globalSettings.substitute`, `profileRoot.substitute`, `toBeDecided` firstly, then the key will be formatted base on following rules:
        *   if the key of rule is like `domain:port`, the formatted key will be `domain:port`
        *   if the key of rule is like `domain`(without port), the formatted key will be `domain:80` (80 for httpFixedRule, 443 for httpsFixedRule)
        *   if the key of rule is like `*domain*`(without port), the formatted key will be `*domain*:80` (80 for httpFixedRule, 443 for httpsFixedRule)
    *   then for the same formatted key in individual profile and global profile, the value of http(s)FixedRule will be merged, please refer to the example below:

2.  **how are the global profiles merged into active profile:**
    *   If a rule key(domain:port) exists only in the global profile: 
        *   it is copied into the active profile.
    *   If a rule key(domain:port) exists in both:
        *   `hackRequest` and `hackResponse` are **merged** (global's one runs first).
        *   Other fields (`target`,`customizedProxy`,`bypassCors`,`keepHostHeader`) defined in the global rule are **ignored**.

3.  **Example of Merging global profile into a individual profile:**
```json
// here is a individual profile named `example-profile`:
{
  "profile": [
    {
      "name": "example-profile",
      "proxy": {
        "proxyUrl": "http://{{globalStgProxyHost}}:81",
        "globalProfile": [
          "global-profile-1"
        ],
        "httpsFixedRule": {
          "*.example.com": {
            "hackRequest": [
              "hackRequestFunction1(anyParameter)"
            ],
            "hackResponse": [
              "hackResponseFunction1(anyParameter)"
            ]
          }
        },
        "httpFixedRule": {}
      }
    }
  ]
}
```
```json
// here is a global profile named `global-profile-1`:
{
  "globalSettings": {
    "substitute": {
      "globalStgProxyHost": "example-proxy.com"
    },
    "profileSet": {
      "global-profile-1": {
        "httpsFixedRule": {
          "*.example.com:443": {
            "target": "https://example.com:443",
            "customizedProxy": "http://another-proxy.com:9000",
            "keepHostHeader": true,
            "bypassCors": true,
            "hackRequest": [
              "hackRequestFunction2(anyParameter)"
            ],
            "hackResponse": [
              "hackResponseFunction2(anyParameter)"
            ]
          },
          "*.example2.com:443": {
            "target": "https://example2.com:443",
            "customizedProxy": "http://another-proxy2.com:9000"
          }
        },
        "httpFixedRule": {}
      }
    }
  }
}
```
```json
// When you start the `example-profile`, the rules from `global-profile-1` will be merged into it,
// resulting in the following effective configuration:
{
  "name": "example-profile",
  "proxy": {
    "proxyUrl": "http://example-proxy.com:81", // replaced by the value defined in globalSettings.substitute
    "globalProfile": [
      "global-profile-1"
    ],
    "httpsFixedRule": {
      "*.example.com:443": {
        // as you can see, although global profile has "target"/"customizedProxy"/"keepHostHeader"/"bypassCors" fields, 
        // they are ignored because individual profile don't have them and individual profile has higher priority,
        // so the eventual rule for "*.example.com:443" will be:
        // ① no "target" which means the target(protocol+host+port) of the request won't be changed. 
        // ② no "customizedProxy" which means the request will be sent directly to target without using any secondary proxy server. 
        // ③ no "keepHostHeader" means keepHostHeader=false.
        // ④ no "bypassCors" means bypassCors=false.
        "hackRequest": [
          // field hackRequest and field hackResponse are merged, and the order of execution is from global profile to individual profile
          "hackRequestFunction2(anyParameter)",
          "hackRequestFunction1(anyParameter)"
        ],
        "hackResponse": [
          "hackResponseFunction2(anyParameter)",
          "hackResponseFunction1(anyParameter)"
        ]
      },
      "*.example2.com:443": {
        // because individual profile don't have any rule for "*.example2.com:443",
        // the rule from global profile is used directly
        "target": "https://example2.com:443",
        "customizedProxy": "http://another-proxy2.com:9000"
      }
    },
    "httpFixedRule": {
      // how the httpFixedRule is merged is same as httpsFixedRule
    }
  }
}
```

3.  **Priority of Rules:**
After merging, suppose there are multiple rules that can match a request, the priority of rules is as follows:
    *   exact match in http(s)FixedRule(there is always a port, because the key is formatted) > 
    *   wildcard match in http(s)FixedRule(there is no promise that which wildcard rule will be matched first) >
    *   hostBypassProxy > 
    *   hostUsingProxy

```json
    {
  "name": "example-profile",
  "proxy": {
    "proxyUrl": "http://example-proxy.com:81",
    "proxyPort": 8000,
    "hostUsingProxy": [
      // Fifth priority
      "*.example.com"
    ],
    "hostBypassProxy": [
      // Forth priority
      "*.example.com"
    ],
    "globalProfile": [
      "global-profile-1"
    ],
    "httpsFixedRule": {
      "*.example.com:443": {
        // Second or Third priority
        "customizedProxy": "http://another-proxy.com:9000"
      },
      "a.example.com:443": {
        // First priority
        "customizedProxy": "http://another-proxy.com:8000"
      },
      "a.example.*:443": {
        // Second or Third priority
        "customizedProxy": "http://another-proxy.com:7000"
      }
    }
  }
}
```

## Hack Function 🧪
1. **Basic**
    * Although it's possible, please AVOID editing hack function directly in the configuration file. Instead, you should go to `hack functions` tab by clicking `Edit Config` -> `hack functions`(tab), and follow the instructions in the editor to define your own hack function. 
    * After writing the code, you will find the change is synced to the field of configuration.reusableHackFunctions automatically. 
    * You can click `Save and Close` button to apply the changes then.

2. **Priority**
    * Hack function will decide the eventual request sent to target server and the eventual response sent back to caller, 
    * Because it will be called after customizedProxy/target/keepHostHeader/bypassCors take effect.

3. **Explanation for the field of reusableHackFunctions**
```json
{
  "reusableHackFunctions": {
    "overwriteCookiesInResponseHeaders": [ // function name
      // The First item is reserved for saving comment of the function
      "/** any comment */",
      // The Second item is the function body,it's a NESTED arrow function. 
      // The first parameter is used for initializing the function, the second parameter is the original requestOptions and original Response. 
      // You must return the modified originalResponse in the inner function
      "newCookies=>(requestOptions,originalResponse)=>{return originalResponse;}" 
    ],
    "overwriteCookiesInRequestHeaders": [ // function name
      // First item is reserved for saving comment of the function
      "/** any comment */", 
      // Second item is the function body,it's a NESTED arrow function.
      // The first parameter is used for initializing the function, the second parameter is the original requestOptions.
      // You must return the modified requestOptions in the inner function
      "newCookies=>(requestOptions)=>{return requestOptions;}"
    ]
  }
}
```
4. **How to use hack function**
    * you can use the function in `hackRequest` or `hackResponse` field by specifying the function name and parameter like below:
```json
{
  // Whenever the configuration is updated, Outer function will be executed as the way of how it's defined in hackRequest or hackResponse.
  // So that, inner function can be retrieved and cached before starting a profile.
  "hackRequest": [ // Inner function will be executed right before sending request to target server
    "overwriteCookiesInResponseHeaders(anyParameterToInitializeFunction)" 
  ],
  "hackResponse": [ // Inner function will be executed right after a response is received from target server
    "overwriteCookiesInResponseHeaders(anyParameterToInitializeFunction)" 
  ]
}
```

## Troubleshooting 🧯
1.  **If page cannot be opened and error is like : `(failed)net::ERR_EMPTY_RESPONSE`.**
    * you need to set "127.0.0.1" but NOT "localhost" for Checkout-Proxy from your browser's plugin(FoxyProxy or SwitchyOmega).
2.  **On macOS, Checkout-Proxy response following error message:`{"code":"ENOTFOUND","message":"getaddrinfo ENOTFOUND...}`.**
    * you need to give Local Network permission to Checkout-Proxy by [System Settings] -> [Privacy&Security] -> [Local Network] -> [find Checkout-Proxy and turn on the switch]. Especially for the host ending with `.local`.
3.  **I want to test Safari/IOS Simulator, but Checkout-Proxy could not work properly with VPN while OS proxy is on.**
    *  You need to follow the following steps (Especially, the order of step MUST NOT be messed up): 
        * [toggle OS proxy on by feature of "Toggle System Proxy ON/OFF" or do it manually by OS setting] **profile is not started at this moment
        * [connect VPN]
        * [start a profile]
4.  **Checkout-Proxy rarely crashes right after reconnecting the VPN while this APP is set as an OS level proxy. Especially for ARM series Mac**
    *  it's due to https://github.com/nodejs/node/issues/54717#issuecomment-2327982075. Some countermeasures have been included, but if it still happen, You can just restart the APP for now, or any of the following workarounds should help:
        *  when OS proxy is on, before (re)connecting to VPN, always turn off the profile of Checkout-Proxy.
        *  turn of ipv6 by [Go to your OS Wi-Fi settings]->[Details...]->[TCP/IP]->[Configure IPv6]->[Link-local only] or by command line: `networksetup -setv6off Wi-Fi`(you can turn it on again by `networksetup -setv6automatic Wi-Fi`)
5.  **Can I use https proxy?**
    * Yes, you can use `https` in the fields of `profile[n].proxy.proxyUrl` and `http(s)FixedRule.customizedProxy`. For example: `https://user1:mypassword123@example.com`
6.  **Requests are failed or hanging.**
    * **Possible symptoms:**
        * Request to external site is failed.
        * Request hangs for a long time and timeout.
    * **How to confirm this issue:** You can identify this issue by closing/stopping Checkout-Proxy, yet your browser extension (e.g., FoxyProxy / SwitchyOmega) is still configured to send traffic to Checkout-Proxy. Then, You cannot receive an error immediately after sending the request to some external sites.
    * **Root cause:** Security software such as Netskope Client installed as a Network Extension. Network Extension can silently hijack traffic before the traffic arrive Checkout-Proxy without actually listening a port. So, in that case, you cannot even find the usage of the port by `netstat` or `nc` command. these Network Extensions apply their own rules to the traffic, then sometimes it neither pass traffic to Checkout-Proxy correctly nor pass the request to target directly.
    * **Workarounds:**
        * **Avoid enabling System Proxy unless necessary.** Unless you need to test Safari or simulators, keeping System Proxy off can minimize the chance of network extensions like Netskope discovering and contaminating the ports used by Checkout-Proxy.
        * **Change Checkout-Proxy's ports** Once issue happened, the easiest way to fix is to change the port where Checkout-Proxy listen on. Change the first port of `appPort` within your configuration，and apply this new port for your browser extension's proxy setting. Your new port should be safe for a long time.
        * **Use Uncommon high ports** From v1.6.5, instead of 8001 and 8002, 18881 will be the default and only port of factory configuration.
        * **Restart your Mac** this can reset Netskope's behavior to not monitor a specific port

## Feedback and Issues 💬
Feel free to reach out if you have any questions or issues.
