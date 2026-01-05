# Checkout-Proxy User Guide

## Introduction

Checkout-Proxy is a local proxy application designed to facilitate web development and testing.
Here are some of its key features:
1.  dynamically generating SSL certificates for each requested domain on the fly. This will allows your browser to always validate the certificates and establish a secure connection
2.  high flexible and scalable configuration, allowing you to manage many different requirements in minimal count of profiles
3.  support for proxying HTTPS request to HTTP target, or vice versa
4.  support user-defined hack functions for modifying request and response on the fly, allowing you to handle some advanced scenarios like using different remote proxy for different request path, overwriting cookies in request/response headers, etc.
5.  support for using global profiles and global constant, allowing you to reuse common proxy rules without duplicating them in each profile
6.  support for wildcard matching in domain names, making it easier to define rules for multiple subdomains
7.  placeholder allowing you to define dynamic values that can be replaced at runtime, so you don't need to create multiple profiles for similar requirements
8.  support for controlling system proxy setting directly from the application, making the test for safari browser, emulator, physical device smoother
9.  support bypass-cors option and keep-host-header option for unblocking some tricky scenarios
10. build-in json and javascript editor with syntax highlighting and error checking

## Install the Application
1.  **Download the Application:**
    *   Download the latest release. Choose the appropriate version for your operating system:
        *   **macOS:** `Checkout-Proxy-1.4.X-arm64.dmg`
        *   **Windows:** `Checkout-Proxy-1.4.X-x64.exe`

2.  **Install the Application:**
    *   **macOS:** Open the downloaded `.dmg` file and drag the `Checkout-Proxy.app` to the Applications folder. Before you start the application for the first time, you need to run the following command in terminal: `sudo xattr -r -d com.apple.quarantine /Applications/CheckoutProxy.app` and enter your password when prompted. That's because I am not a registered Apple developer, macOS will block the application from running.
    *   **Windows:** execute `.exe` install file and follow the installation instructions. You may need to allow the application through your firewall when you start a profile of Checkout Proxy for the first time.

## Before Using
1.  **Create and Trust Root CA:**
    *   click [More]->[Create and Trust CA certificate] in main window and follow the step to ask system to trust new CA certificate. OS may ask you for password or confirmation.
        *   if you didn't trust new CA certificate by OS prompt, you can redo [More]->[Create and Trust CA certificate]
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

2.  **Browser Configuration:**
    *   Configure your browser or system to use `127.0.0.1:8001` (replace `8001` if you've changed specified config of Checkout Proxy) as its HTTP proxy.
        *  it's recommended to use a browser extension like [FoxyProxy](https://addons.mozilla.org/en-US/firefox/addon/foxyproxy-standard/) or [SwitchyOmega](https://chromewebstore.google.com/detail/proxy-switchyomega-3-zero/pfnededegaaopdmhkdmcofjmoldfiped?pli=1).
    *   **Safari on MacOS**: you need to set both `Web Proxy (HTTP)` and `Secure Web Proxy (HTTPS)` from `System settings` -> `Wi-Fi` -> `Details` -> `Proxies`. You must set system proxy before connecting to VPN, otherwise proxy won't work properly.
    *   **Safari or mobile APP on IOS Simulator:** Aside from setting system proxy and connecting to VPN, You also have to add root certificate for simulator by running the following command in terminal: `xcrun simctl keychain booted add-root-cert ~/Downloads/checkout-proxy-rootCA.crt`.

## Using the Application
1.  **Operation Manual:**
    *   **Top Buttons:**
        *   **More:** Open a menu.
            *   **Open Help Window** Open this help document.
            *   **Create and Trust CA Certificate** Abolish current Root CA certificate and generate a new one. Then ask OS to trust the new one.
            *   **Download CA Certificate** Download current Root CA certificate if exist. Command for adding certificate by command line will also be copied.
            *   **Toggle System Proxy ON(OFF)** Turn on/off system proxy setting for you(if you click turn on, it will set Checkout-Proxy's host and port for you). It's useful when you want to use proxy for some applications in your system. Especially for Safari browser which doesn't support proxy extension.
            *   **Clear App Cache** Clear Code Cache, Http Cache, Dictionary Cache and so on.
        *   **Edit Config:** Opens a JSON editor to modify the proxy rules and profiles. Click `Save and Close` to apply.
        *   **Import Config:** Loads a configuration JSON file from your system.
        *   **Export Config:** Saves the current configuration to a file.
        *   **Direct Connect:** Start proxy server without using any fixed rule and remote proxy.
        *   **Stop:** Stops the running proxy servers using port 8001 and 8002(default).
    *   **Reset Options Button(in Config Editor):**
        *   **Reset text area to factory config':** Original Default Config is the configuration file shipped with this application. It will not be changed by any user operation.
        *   **Restore text area from backup:** User Default Config is the configuration saved by choosing "Save current text as User Default Config" button.
        *   **Backup current text area:** Click to save current text as User Default Config.
    *   **More Button(in Profile Editor):**
        *   **Save as new profile and Close:** Click to save the current configuration as a new profile and close the editor.
        *   **Remove current profile:** Click to remove current profile.

## Customize Configuration File

The configuration is a JSON object with a `profile` array:

```json
{
  // Version of the configuration file, this filed is used for informing you in case newer configuration format is released. you should not change this value.
  "configVersion": 1,
  "appPort": [ // you must specify two ports for this APP
    8001, // the first Port reserved for this APP, default is 8001, you should always use this port to access Checkout Proxy,
    8002 // the second Port reserved for this APP, default is 8002, you should never access this port directly
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
        "proxyUrl": "http://stg.proxy.com:5702", // specify the protocol,host,port for remote proxy. Only http is supported for now.
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
            // specify the target protocol, domain and port. Only http is supported for now.
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

## Placeholder

You can use placeholder like `{{key}}` in the configuration file.
Placeholder in both individual profile and global profile will be decided and replaced by field `substitute` and `toBeDecided`.
Both individual profile and config.globalSettings can have `substitute` field.

The value of the key defined in `tobeDecided` will be decided through a popup once you click `Start` button of a profile(Maximum 2 items are allowed in this field). As comparison, the value of each key defined in `substitute` is fixed.

Here is the priority of deciding the value of a placeholder:
`tobeDecided` > `substitute` in individual profile > `substitute` in globalSettings

Properties which can use placeholder(same for `tobeDecided`, `substitute` in individual profile, `substitute` in globalSettings):
*   value of `profileRoot.proxy.proxyUrl`
*   value of `profileRoot.proxy.hostUsingProxy` and `profileRoot.proxy.hostBypassProxy`
*   all the keys in the `http(s)FixedRule`
*   value of `http(s)FixedRule.target`
*   value of `http(s)FixedRule.customizedProxy`
*   value of `http(s)FixedRule.bypassCors` (after replacing, empty string means false, any other value means true)
*   value of `http(s)FixedRule.keepHostHeader` (after replacing, empty string means false, any other value means true)
* item of `hackRequest` array and `hackResponse` array in `http(s)FixedRule`
* item of `globalProfile` array

## Wildcard Matching

You can use wildcard `*` at the beginning or the end of the key in `http(s)FixedRule` or the item of `hostUsingProxy` and `hostBypassProxy`.

## Global Settings

1.  **How does the key of http(s)FixedRule decided by Default port, Wildcard and Placeholder :**
    *   when you start a profile, the placeholder in the key of http(s)FixedRule will be replaced by defined `globalSettings.substitute`, `substitute`, `toBeDecided` firstly, then the key will be formatted base on following rules:
        *   if the key of rule is like `domain:port`, the formatted key will be `domain:port`
        *   if the key of rule is like `domain`(without port), the formatted key will be `domain:80` (80 for httpFixedRule, 443 for httpsFixedRule)
        *   if the key of rule is like `*domain*`(without port), the formatted key will be `*domain*:80` (80 for httpFixedRule, 443 for httpsFixedRule)
    *   then for same formatted key in individual profile and global profile, the value of http(s)FixedRule will be merged, please refer to the example below:

2.  **Example of Merging global profile into a individual profile:**
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

## Hack Function
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

## Troubleshooting
1.  **If page can not be opened and error is like : `(failed)net::ERR_EMPTY_RESPONSE`.**
    * you need to set "127.0.0.1" but NOT "localhost" for Checkout-Proxy from your browser's plugin(FoxyProxy or SwitchyOmega).
2.  **On macOS, Checkout-Proxy response following error message:`{"code":"ENOTFOUND","message":"getaddrinfo ENOTFOUND...}`.**
    * you need to give Local Network permission to Checkout-Proxy by [System Settings] -> [Privacy&Security] -> [Local Network] -> [find Checkout-Proxy and turn on the switch]. Especially for the host ending with `.local`.
3.  **I want to test Safari/IOS Simulator, but Checkout-Proxy could not work properly with VPN while OS proxy is on.**
    *  You need to follow following steps (Especially, the order of step MUST NOT be messed up):
        * [toggle OS proxy on by feature of "Toggle System Proxy ON/OFF" or do it manually by OS setting] **profile is not started at this moment
        * [connect VPN]
        * [start the profile you want to use]
4.  **Checkout-Proxy rarely crashes right after reconnecting the VPN while this APP is set as OS level proxy. Especially for ARM series Mac**
    *  it's due to https://github.com/nodejs/node/issues/54717#issuecomment-2327982075. Some countermeasures has been included, but if it still happen, You can just restart the APP for now, or any of following workarounds should help:
        *  when OS proxy is on, before (re)connecting to VPN, always turn off the profile of Checkout-Proxy.
        *  turn of ipv6 by [Go to your OS Wi-Fi settings]->[Details...]->[TCP/IP]->[Configure IPv6]->[Link-local only] or by command line: `networksetup -setv6off Wi-Fi`(you can turn it on again by `networksetup -setv6automatic Wi-Fi`)
5.  **Can I use https proxy?**
    * Not supported yet, which means you can not use `https` in the fields of `profile[n].proxy.proxyUrl` and `http(s)FixedRule.customizedProxy`.

