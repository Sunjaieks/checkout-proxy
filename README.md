# Checkout-Proxy User Guide

## Introduction

Checkout-Proxy is a powerful local proxy application designed for web development and testing. 🚀
It enables you to intercept, inspect, and modify HTTP/HTTPS traffic with ease, focusing on flexible routing and quick UI tools for daily debugging.

### ✨ Key Features

*   🔐 **On-the-fly SSL Certificate Generation**: Dynamically generates SSL certificates for each requested domain, allowing your browser to establish secure connections.
*   🧩 **Flexible Configuration**: Profile-based configuration system with support for global profiles and reusable rule sets.
*   🔁 **HTTP/HTTPS Interoperability**: Support for proxying HTTPS requests to HTTP targets and vice versa.
*   ⛓️ **Upstream Proxy Chaining**: Route traffic through a secondary/upstream proxy per profile (`proxy.proxyUrl`) or per rule (`customizedProxy`). HTTP, HTTPS, and SOCKS (`socks`/`socks4`/`socks4a`/`socks5`/`socks5h`) upstream proxies are supported.
*   🛠️ **Custom Hack Functions**: Define JavaScript functions to modify requests and responses on the fly for advanced scenarios (e.g., cookie manipulation, dynamic routing).
*   🌐 **Wildcard Domain Matching**: Support for `*` wildcards in domain names and ports for broad rule coverage.
*   ✍️ **Built-in Editor**: Integrated JSON and JavaScript editor with syntax highlighting and error checking.
*   🧭 **System Proxy Control**: Easily toggle OS-level proxy settings for Safari, simulators, and mobile devices.
*   🧾 **Request Console**: A live dashboard to monitor and filter proxied traffic.
*   🔗 **Utility Tools**: Built-in tools for URL encoding/decoding and MD5 hashing.
*   🧪 **Advanced Options**: Bypass-CORS and Keep-Host-Header support for complex debugging scenarios.
*   🏷️ **Optional Trace Headers**: Append `checkout-proxy-use-agent` to responses to track proxy routing.
*   🤖 **AI Control (MCP Server)**: A built-in [Model Context Protocol](https://modelcontextprotocol.io) server lets AI assistants start/stop profiles, switch to Direct Connect, list profiles, inspect the running profile, read the whole configuration, add/edit/remove a profile and maintain the shared `globalSettings` sections (both only after showing you the change for approval), look up your hack functions' documented signatures, and fetch this user guide so they can help you configure the app. See [Control by AI (MCP Server)](#control-by-ai-mcp-server-).
*   🖥️ **AI Desktop**: Launch a local AI workspace ([`@cloudcli-ai/cloudcli`](https://www.npmjs.com/package/@cloudcli-ai/cloudcli)) and view it full-screen in an independent session. See [AI Desktop](#ai-desktop-).

## How This Guide Is Organised 🗺️

This guide has two parts, written for two different readers.

*   **[Part 1 · For You](#part-1--for-you-)** — the whole user guide: installing, trusting the CA, connecting your browser, every button, the complete configuration format, and troubleshooting. **This is the part you read.**
*   **[Part 2 · For AI Agents](#part-2--for-ai-agents-)** — written in the second person to an AI assistant: which MCP tool to call, and what it must show you before changing anything. It carries no configuration documentation of its own; it links back into Part 1 for that. **You never need to read it.**

The whole document is what the `get_usage_guide` MCP tool serves, so an assistant reads Part 1 to learn the format and Part 2 to learn how to behave.

# Part 1 · For You 👤

Everything from here to the end of Part 1 is written for you, the person using Checkout-Proxy: how to install it, how to drive it, how the configuration file is put together, and what to do when something misbehaves.

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
            *   **AI Desktop** Launch a local AI workspace and show it full-screen in an independent session. See [AI Desktop](#ai-desktop-) for setup.
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
  // optional: AI integrations. Lives under globalSettings (see globalSettings.ai below).
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
        "proxyUrl": "http://stg.proxy.com:5702", // specify the protocol, host, port for remote proxy. http, https, and SOCKS proxies are supported (SOCKS schemes: socks/socks4/socks4a/socks5/socks5h, e.g. "socks5h://user:pass@127.0.0.1:1080"; use socks5h/socks for proxy-side DNS, socks5/socks4 for client-side DNS).
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
            // specify the secondary proxy server, if you don't want to use secondary proxy server, you can omit this field. http/https/SOCKS URLs are supported (same schemes as proxy.proxyUrl)
            "customizedProxy": "http://specified.proxy.domain.com:5703",
            // if you want to keep the original host header, you can set this field to true, default is false, in most of the case you don't need to set this field
            "keepHostHeader": true,
            // if you want to bypass CORS restriction, you can try to set this field to true, default is false
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
    // optional: AI integrations (MCP server + AI Desktop launcher). All fields are optional.
    "ai": {
      "mcpEnabled": false, // optional: enable the built-in MCP server (default: false)
      "mcpPort": 18888,    // optional: loopback port the MCP server listens on (default: 18888)
      "guiCommand": "", // optional: full command launched by [Tools]->[AI Desktop], may carry an inline env prefix e.g. "SERVER_PORT=18887 cloudcli" (empty by default; auto-filled the first time you use AI Desktop)
      "guiPort": ""     // optional: the plain port that command serves on; the AI Desktop window loads http://localhost:<guiPort> (empty by default; auto-filled together with guiCommand)
    },
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
    * 💡 Keep that comment meaningful: it is the function's usage contract. The app hands it to AI assistants through the MCP `list_hack_functions` tool, so a well-written `[0]` is what lets an assistant call your function correctly. **A function whose comment you leave empty is reported to the assistant as unusable, and it is instructed never to call or suggest it** — that is deliberate, since without the contract it would only be guessing at your arguments. The three built-ins ship with a full JSDoc comment describing their parameters and an example call; if you blank one out, that function drops out of an assistant's reach until you document it again.
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

## Tips for Configuration and Profile Design 🎯

These conventions keep profiles predictable, reusable, and easy to reason about. Follow them whenever you edit the configuration by hand — and expect an AI assistant to follow them too, because [Part 2](#part-2--for-ai-agents-) makes them binding on any advice or profile it produces.

1.  **Keep each profile within a single environment.** 🌱
    *   A profile whose name contains `stg` should route **only** staging URLs; a profile whose name contains `prod` should route **only** production URLs. Let the profile name honestly describe the one environment it serves.
    *   Do **not** mix environments inside one profile. For example, within the same profile it is inappropriate to send the top page through a **stg** proxy while the history page goes through a **prod** proxy (or is explicitly routed with no proxy). Mixing environments makes the effective routing hard to predict and easy to get wrong — split them into separate `stg` and `prod` profiles instead.
    *   If a page genuinely must talk to a different environment, make that an intentional, new profile of its own rather than a hidden exception inside an environment profile.

2.  **Reuse rules via `globalSettings.profileSet` instead of duplicating them.** ♻️
    *   Rules defined under `globalSettings.profileSet` are named rule sets (global profiles) that **any** profile can pull in through its `proxy.globalProfile` array — see [Global Settings](#global-settings-) for exactly how they are merged.
    *   If a rule (a `http(s)FixedRule` entry, a `customizedProxy` mapping, a common hack, etc.) is likely to be shared by more than one profile, define it **once** in `globalSettings.profileSet` and reference it from each profile, rather than copy-pasting it into every profile. This reduces duplication and means you update the rule in a single place.
    *   Remember the merge rules: for a rule key present in both a global profile and the individual profile, `hackRequest` / `hackResponse` are concatenated (global first) while other fields (`target`, `customizedProxy`, `keepHostHeader`, `bypassCors`) come from the individual profile and the global ones are ignored. Design your shared rules with that precedence in mind.

3.  **Treat `hackRequest` and `hackResponse` as the last resort — reach for any other field first.** 🧪
    *   Every other field of a profile is declarative: you state what you want and the proxy carries it out. `hackRequest` and `hackResponse` are the exception — they run JavaScript against live traffic, so a mistake surfaces as a broken request rather than a save-time error, and the real behaviour is no longer visible at a glance in the JSON.
    *   So before adding a hack, see whether **any** other field already expresses what you need — not just one or two, but the whole rest of the profile: the `http(s)FixedRule` key itself, `target`, `customizedProxy`, `keepHostHeader`, `bypassCors`, `proxyUrl`, `hostUsingProxy`, `hostBypassProxy`, `globalProfile`, `substitute`, `toBeDecided`.
    *   Only when none of them can do it — rewriting cookies, choosing the proxy per request path, rewriting a path prefix — is a hack the right tool. If you ask an AI assistant to set up a profile, it is instructed to follow this same order and to tell you which fields it tried before falling back to a hack.
    *   `reusableHackFunctions` is a shared library used across profiles and rules, so try **not** to modify its existing entries. Changing a function body or renaming a function can silently alter the behaviour of every rule that calls it.
    *   When a hack *is* warranted, check whether one of the built-in functions already does the job and **call it** from a rule's `hackRequest` / `hackResponse` array as `functionName(initArgs)` (see [Hack Function](#hack-function-) for the calling convention). The functions shipped in the default configuration are:
        *   **`overwriteCookiesInRequestHeaders(newCookies)`** → use in **`hackRequest`**. Rewrites the outgoing **`Cookie`** request header. `newCookies` is an array of `key=value` strings: `key=value` overwrites that cookie (or adds it when absent) and `key=` (empty value) removes it.
            *   Force a cookie towards the server: `"hackRequest": ["overwriteCookiesInRequestHeaders(['Rp=0000'])"]`
            *   Set two cookies and drop a third: `"hackRequest": ["overwriteCookiesInRequestHeaders(['abtest=on', 'lang=en', 'legacyFlag='])"]`
        *   **`overwriteCookiesInResponseHeaders(newCookies)`** → use in **`hackResponse`**. Rewrites the **`Set-Cookie`** response header with the same `newCookies` format: `key=value` overwrites the `Set-Cookie` for that cookie and `key=` removes it.
            *   Pin the cookie the server sets back to the browser: `"hackResponse": ["overwriteCookiesInResponseHeaders(['Rp=0000'])"]`
        *   **`overwriteRuleForPath(pathConfigMap, defaultConfig?)`** → use in **`hackRequest`**. Chooses the upstream proxy, the target (protocol/host/port), and/or rewrites the path prefix, all keyed by **request path prefix**. `pathConfigMap` maps a path prefix to a config object `{target?, proxyUrl?, path?}` (the first matching prefix wins); the optional second argument is a fallback config for paths that match none. `target` changes the destination (and the Host header) — any path in `target` is ignored; `proxyUrl` picks the upstream proxy (`null` clears it so the request goes direct); `path` rewrites the matching path prefix, the replacement for that prefix (same convention as a path-prefix rewrite: the first matching prefix wins).
            *   Proxy one path and send another direct: `"hackRequest": ["overwriteRuleForPath({'/com/inc/viewer':{proxyUrl:'http://{{globalStgProxyHost}}:{{globalStgToolPort}}'},'/com/advance/':{proxyUrl:null}})"]`
            *   Change the target for a path: `"hackRequest": ["overwriteRuleForPath({'/old/api':{target:'https://a.example.com:443'}})"]`
            *   Rewrite a path prefix: `"hackRequest": ["overwriteRuleForPath({'/old/api':{path:'/new/api'}})"]`

4.  **Pick the right placeholder mechanism.** 🧷
    *   Use `toBeDecided` for values you want to choose **at start time** via the popup (max 2 entries per profile), e.g. `"proxyPort=5801,5802"`.
    *   Use `substitute` for **fixed** reusable values. Put substitutions that many profiles share in `globalSettings.substitute`, and profile-specific ones in the profile's own `substitute`.
    *   Priority is `profileRoot.toBeDecided` > `profileRoot.substitute` > `globalSettings.substitute` (see [Placeholder](#placeholder-)).

5.  **Choose the narrowest routing tool for the job.** 🎯
    *   Use `hostUsingProxy` / `hostBypassProxy` for broad, host-based routing through the profile's `proxyUrl`.
    *   Use `http(s)FixedRule` when you need to remap a specific `host:port`, change the `target`, or send it through a `customizedProxy`.
    *   `Http(s)FixedRule` entries are self-sufficient — a matching rule intercepts the request on its own; the host does not also need to be listed in `hostUsingProxy`.
    *   Keep [rule priority](#global-settings-) in mind and avoid overlapping wildcard rules that make it ambiguous which rule wins.

6.  **Don't hand-edit `configVersion`.** 🔒 It only tells the app whether your configuration format is current; leave it untouched.

7.  **Never leave a URL without a scheme.** 🧭 `proxyUrl`, `target` and `customizedProxy` all need an explicit `http://` / `https://` (or, for an upstream proxy, a SOCKS scheme) — a bare domain like `new.example.com` is not a shortcut, it fails silently at request time instead of at save time. A missing *port* is fine, the app defaults it from the scheme; a missing *scheme* is not. If you are asking an AI assistant to add a new domain and have not said which protocol it uses, expect it to ask you rather than guess — see [Read These Before You Advise or Act](#read-these-before-you-advise-or-act-) in Part 2.

8.  **Verify before you rely on it.** ✅ After changing a profile, start it and open [Effective Profile] (or call the MCP `get_effective_profile` tool) to confirm the fully-resolved rules — placeholders substituted and global profiles merged — are what you expect.

## Tips for Usage 💡

A few interactions in the main window are easy to miss but save a lot of time — worth knowing whether you drive the app by hand or through an AI assistant:

*   **Check the effective profile — click the active profile name.** 🔍 While a profile is running, its name is shown at the **top-right of the title area** (after `Active:`). Click that name to open the **Effective Profile** viewer: the fully-resolved profile with placeholders substituted and global profiles merged.
*   **Copy a profile's name — click the icon at its far left.** 📋 In the profile list, the small icon on the **left-most side of each profile row**, just before the profile name, copies that profile's name to the clipboard; Handy for pasting the exact name into a command, an MCP `start_profile` call, or a chat message.

## Control by AI (MCP Server) 🤖
Checkout-Proxy ships with a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server, so AI assistants can drive the proxy for you — the same actions you would take by clicking in the app.

*   **Availability**: The MCP server starts automatically with the app and stays available for the whole session, independent of whether a proxy profile is running.
*   **Endpoint**: `http://127.0.0.1:18888/mcp` (HTTP `POST`, [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) transport, JSON-RPC 2.0).
*   **Configuration**: Controlled by the optional `globalSettings.ai` field in your configuration:
    ```json
    "globalSettings": {
      "ai": {
        "mcpEnabled": false, // optional: set to true to enable the MCP server (default: false)
        "mcpPort": 18888     // optional: TCP port the MCP server listens on (default: 18888)
      }
    }
    ```
    The field is optional. The MCP server is **disabled** unless `mcpEnabled` is explicitly `true`. Changes take effect after you save or import the configuration. (The same `ai` object also holds the AI Desktop settings — see [AI Desktop](#ai-desktop-).)
*   **Notice**: `manage_profile` is the only tool that writes, and it can reach exactly two things: the `profile` array, and the `others` / `substitute` / `profileSet` sections of `globalSettings`. A single call may change one or both — both together land as one atomic save, so a change like "add a shared rule set and point this profile at it" cannot be left half-applied. In every case the assistant is instructed to show you the change first — a diff when editing, the full profile JSON when adding, the profile being deleted when removing, a diff of each section when editing `globalSettings` — and to wait for your approval before calling it. Everything else is off-limits to AI clients by design: **`globalSettings.ai`** (the MCP server's own enable flag/port and the AI Desktop command — so an assistant can never switch off or move the channel you control it through), **`reusableHackFunctions`** (the JavaScript bodies of your hack functions), **`appPort`** and **`configVersion`**. Those you change yourself in the app ([Edit Config]).
*   **What the assistant is told to do**: [Part 2](#part-2--for-ai-agents-) of this guide is written for the assistant rather than for you — it lists every tool and the rules the assistant must follow. You never need to read it, but it is there if you want to know exactly what your AI client has been instructed to do.

### Add this MCP setting to your AI client
Point any MCP client that supports the **Streamable HTTP** transport at the endpoint, for example:

```json
{
  "mcpServers": {
    "checkout-proxy-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:18888/mcp"
    }
  }
}
```

For clients that only support the stdio transport, use a bridge such as [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (e.g. `npx mcp-remote http://127.0.0.1:18888/mcp`).

### Security

*   The server binds to **loopback only** (`127.0.0.1`) and validates the `Origin` header to prevent DNS-rebinding attacks from web pages.
*   There is **no authentication**: any local process that can reach the port can control the proxy. This is acceptable because it is reachable only from your own machine. The MCP server is off by default; enable it only when needed via `globalSettings.ai.mcpEnabled`.
*   `manage_profile` is the only tool that writes to your configuration, and it is confined to the `profile` array plus the `others` / `substitute` / `profileSet` sections of `globalSettings`. `globalSettings.ai` and `reusableHackFunctions` cannot be reached through MCP at all — the first keeps an assistant from disabling or relocating the MCP server itself, the second keeps it from rewriting the JavaScript your profiles execute.
*   A profile's `hackRequest` / `hackResponse` entries are **executed as JavaScript** in the app when that profile starts (see [Hack Function](#hack-function-)). Since `manage_profile` can write those arrays, treat a profile added by an AI the way you would treat code from any other source: read it before you start it.

## AI Desktop 🖥️

The **AI Desktop** tool ([Tools]->[AI Desktop]) launches a local AI workspace and shows it full-screen inside Checkout-Proxy. The workspace runs in its own **independent session** (separate from the rest of the app), so it keeps its own storage and cookies.

### Setup ⚙️
*   **Run the installer script for your OS — it installs Node.js (if missing) and `@cloudcli-ai/cloudcli` automatically (⚠️You need to rerun it if you update the major version of Node.js):**
    *   **macOS** (Terminal):
        ```bash
        curl -fsSL https://raw.githubusercontent.com/Sunjaieks/installer/refs/heads/main/cloud-cli/mac-install.sh | bash
        ```
    *   **Windows** (PowerShell):
        ```powershell
        irm https://raw.githubusercontent.com/Sunjaieks/installer/refs/heads/main/cloud-cli/windows-install.ps1 | iex
        ```
*   That's it — click icon nearby the title or  [Tools]->[AI Desktop] to start.
*   (or manually install Node.js from https://nodejs.org/en/download, and install cloudcli via `npm install -g @cloudcli-ai/cloudcli` from command line)

### Advanced (optional) 🔧

You can customize `globalSettings.ai.guiCommand` / `globalSettings.ai.guiPort` via [Edit Config]->[global settings]->[AI] if you want a different command or port:
```json
"globalSettings": {
  "ai": {
    "guiCommand": "SERVER_PORT=18887 cloudcli", // full command Checkout-Proxy launches; may carry an inline env prefix
    "guiPort": 18887                            // the plain port that command serves on; the AI Desktop window loads http://localhost:<guiPort>
  }
}
```

### How it works 🔧
*   Pressing **AI Desktop**: if `guiCommand` is empty, Checkout-Proxy fills in the built-in default command/port, saves the configuration, then launches `guiCommand` in Checkout-Proxy's main process and opens a full-screen window at `http://localhost:<guiPort>`.
*   If the command cannot be launched (e.g. it is not installed), a popup reminds you how to install Node.js and `@cloudcli-ai/cloudcli` (see Setup above).
*   The launched process stays running for the whole app session. When you save the configuration, Checkout-Proxy restarts it **only if `guiCommand` or `guiPort` changed**; otherwise it is left running untouched.

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
        * **Change Checkout-Proxy's ports** Once issue happened, the easiest way to fix is to change the port where Checkout-Proxy listen on. Change the first port of `appPort` within your configuration, and apply this new port for your browser extension's proxy setting. Your new port should be safe for a long time.
        * **Use Uncommon high ports** From v1.6.5, instead of 8001 and 8002, 18881 will be the default and only port of factory configuration.
        * **Restart your Mac** this can reset Netskope's behavior to not monitor a specific port

## Feedback and Issues 💬
Feel free to reach out if you have any questions or issues.

# Part 2 · For AI Agents 🤖

**This part is addressed to you, the AI assistant, not to the user.** It is the operating manual for the MCP tools: what you may call, what you must read first, and what you have to show the user before you change anything. It deliberately repeats none of the configuration documentation — Part 1 is the reference, and the links below point into it.

## Read These Before You Advise or Act 📚

*   Whenever a user asks how to modify a configuration file or customize a profile, your advice must adhere to these principles: **[Tips for Configuration and Profile Design](#tips-for-configuration-and-profile-design-)**. They are binding on every profile and every recommendation you produce.
*   For the meaning of any field — `proxyUrl`, `hostUsingProxy`, `http(s)FixedRule`, `target`, `customizedProxy`, `keepHostHeader`, `bypassCors` — see **[Customize Configuration File](#customize-configuration-file-)**.
*   Before you write a `{{placeholder}}`, check where it is allowed and how it resolves: **[Placeholder](#placeholder-)**.
*   Before you write a rule key with `*`, check what it matches: **[Wildcard Matching](#wildcard-matching-)**.
*   Before you reason about which rule wins, or about `globalProfile` merging, read **[Global Settings](#global-settings-)** — merge order and rule priority are not obvious and getting them wrong silently changes routing.
*   Before you write a `hackRequest` / `hackResponse` entry, read **[Hack Function](#hack-function-)** for the calling convention.
*   **Protocol is mandatory, port is not.** Every URL-valued field (`proxyUrl`, a fixed rule's `target` / `customizedProxy`) must carry an explicit scheme — `https://new.example.com`; a missing port is fine and defaults (80 for http, 443 for https, 1080 for socks). If the user names a domain without saying http, https, or (for an upstream proxy only) a SOCKS variant, stop and ask them before calling `manage_profile` — do not guess. The scheme also decides which fixed-rule bucket a domain belongs in: `httpFixedRule` for http, `httpsFixedRule` for https.

### Where does the change belong: the profile or globalSettings? 🔀

One `manage_profile` call carries two independent parts, and you may send either or both:

*   **`action`** (`add` / `edit` / `remove`) — changes **one profile**.
*   **`globalSettingsJson`** — replaces shared `globalSettings` sections. **Optional**, and independent of `action`.

That gives you three shapes:

| You want to… | Send |
|---|---|
| change one profile | `action` + its profile arguments |
| change shared settings only | `globalSettingsJson`, **no `action`** |
| change both — e.g. *"define a shared rule set and make this profile use it"* | `action` + profile arguments **+** `globalSettingsJson` |

**Prefer the third shape when a request touches both.** It is one atomic write: either the whole change lands or nothing does, and the proxy stops and restarts once rather than twice. Two separate calls would leave the configuration briefly half-applied — a profile referencing a `globalProfile` that does not exist yet, or a rule set nothing points at.

**Deciding which part a change belongs in — ask who else needs it:**

| The change is… | Goes in | Because |
|---|---|---|
| about **one** profile — its `proxyUrl`, its own `hostUsingProxy` / `hostBypassProxy`, its own `http(s)FixedRule` entries, which global profiles it pulls in via `proxy.globalProfile`, its `toBeDecided`, its own `substitute`, its `name` / `decorator` | the **profile** (`profileJson`) | it only affects that profile |
| a named rule set that **several profiles reference by name** → `profileSet` | **`globalSettingsJson`** | it is the shared library profiles opt into |
| a value **many profiles interpolate** as `{{key}}` → `substitute` | **`globalSettingsJson`** | one definition, used everywhere |
| an **app-wide toggle** — `addAgentHeader`, `recording` → `others` | **`globalSettingsJson`** | it is not a per-profile concept |

Quick signals in what the user says:

*   *"for this profile"*, *"in stg-5702"*, *"only when I run X"* → the **profile**.
*   *"everywhere"*, *"for all profiles"*, *"globally"*, *"by default"* → **`globalSettingsJson`**.
*   The value already appears in more than one profile → move it into **`globalSettingsJson`**, and in the same call edit the profile to reference it via `globalProfile` / `{{placeholder}}`. Reusing beats duplicating — see [Tips for Configuration and Profile Design](#tips-for-configuration-and-profile-design-).

### What `manage_profile` may never write ⛔

Three things stay out of reach no matter which action you use, and no argument will bypass them:

*   **`globalSettings.ai`** — the MCP server's own enable flag and port, plus the AI Desktop command. You reach the user *through* this; being able to rewrite it would let you switch off or relocate their only control over you.
*   **`reusableHackFunctions`** — the JavaScript bodies of hack functions.
*   **`appPort`** and **`configVersion`**.

For any of these: produce the JSON, explain it, and ask the user to apply it themselves in [Edit Config]. Do not pretend the tool refused for a transient reason — it is a deliberate boundary.

### Prerequisite calls for `manage_profile`

Before **every** `manage_profile` call, two calls are **mandatory**:

*   **`get_usage_guide`** — this document: the field meanings and the design conventions your profile has to satisfy. Never write a profile from memory.
*   **`get_configuration`** — the profiles exactly as stored, so you edit the real thing rather than one you assumed.

A third is **mandatory only when hacks are involved**, in either direction:

*   **`list_hack_functions`** — required if the profile you are editing or removing **already contains** `hackRequest` / `hackResponse`, or if the profile you are about to write **will contain** them. If no hacks are involved on either side, you do not need it. It is equally required before you merely *suggest* a hack entry in chat. See [Calling the User's Hack Functions](#calling-the-users-hack-functions-).

### `hackRequest` and `hackResponse` are the last resort

Every other field of a profile is declarative: it states an intent the proxy carries out. `hackRequest` and `hackResponse` are the exception — they execute JavaScript against the user's live traffic, so a mistake fails at request time rather than at save time.

**So use any other field of the profile in preference to them.** Not just a shortlist — *everything except `hackRequest` and `hackResponse`* comes first: the `http(s)FixedRule` key itself, `target`, `customizedProxy`, `keepHostHeader`, `bypassCors`, `proxyUrl`, `hostUsingProxy`, `hostBypassProxy`, `globalProfile`, `substitute`, `toBeDecided`, and anything else documented in [Customize Configuration File](#customize-configuration-file-).

Write `hackRequest` or `hackResponse` **only when no other field can express what the user asked for** — genuinely hack-shaped work such as rewriting cookies, choosing the upstream proxy per request path, or rewriting a path prefix. When you do, prefer an existing documented function over new inline code, and tell the user plainly which fields you tried and why they fell short.

One more habit worth keeping: after a profile changes, suggest checking [Effective Profile] (or call `get_effective_profile`) so the user can see the fully-resolved result.

## Enabling the Server

The user controls whether you can reach this server at all, and how — see [Control by AI (MCP Server)](#control-by-ai-mcp-server-) in Part 1. If your tool calls fail, the server is most likely disabled in their configuration.

## The Tools You Can Call 🧰
| Tool                    | What it does (same as the app)                                                                                                                                                                                                                                                                      |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `start_profile`         | Start a profile by `profile` (name **or** zero-based index). For profiles with `toBeDecided` placeholders, pass a `toBeDecided` object such as `{"proxyPort":"5801"}`; any omitted placeholder defaults to its first option. Equivalent to clicking **Start** on a profile and choosing its values. |
| `direct_connect`        | Start **Direct Connect** mode (no fixed rules, no upstream proxy).                                                                                                                                                                                                                                  |
| `stop_proxy`            | Stop all running proxy servers (same as **Stop**).                                                                                                                                                                                                                                                  |
| `list_profiles`         | List all available profiles with their index, name and required `toBeDecided` placeholders, and report which profile is currently running.                                                                                                                                                          |
| `get_effective_profile` | Return the effective (fully-resolved) profile of the running proxy — placeholders substituted and global profiles merged — plus the current run status.                                                                                                                                             |
| `get_configuration`     | Return the entire current configuration as JSON (all profiles, `globalSettings`, `reusableHackFunctions`, `appPort`, …) exactly as stored on disk, with placeholders **not** substituted. Use it to inspect the existing setup before proposing edits.                                              |
| `get_usage_guide`       | Return this full guide (the README) as Markdown. Part 1 is where you learn how the configuration is structured, what each field means, and how to design profiles (see [Tips for Configuration and Profile Design](#tips-for-configuration-and-profile-design-)).                                 |
| `manage_profile`        | Write configuration in **one atomic save**. `action` (`add` / `edit` / `remove`) changes **one** profile; the optional `globalSettingsJson` replaces the shared `globalSettings` sections `others`, `substitute`, `profileSet`. Send either or both. Nothing else is writable. **Call `get_usage_guide` and `get_configuration` first, every time.** See [Where does the change belong](#where-does-the-change-belong-the-profile-or-globalsettings-) and [Writing with `manage_profile`](#writing-with-manage_profile-) below.  |
| `list_hack_functions`   | List every reusable hack function the current configuration makes callable, each with its usage documentation and source, plus the `hackRequest` / `hackResponse` calling convention. **Mandatory whenever hacks are involved** — see [Prerequisite calls](#prerequisite-calls-for-manage_profile) and [Calling the Hack Functions](#calling-the-users-hack-functions-) below.  |

## Confirm Before You Write ✋

`manage_profile` writes straight to the user's configuration file and **there is no undo**. Never call it unprompted. **You MUST show the user exactly what will change and wait for their explicit approval first**:

*   **editing** → a diff of the stored profile against the proposed one;
*   **adding** → the complete new profile JSON, plus where it will be inserted;
*   **removing** → the name and JSON of the profile about to be deleted;
*   **changing `globalSettings`** → a diff of each stored section against your replacement, **and the list of profiles the change affects**. `profileSet` and `substitute` are shared, so one edit can alter the resolved rules of profiles the user was not thinking about. Name them.
*   **doing both in one call** → show both halves, and say they land together as a single save.

Call the tool only after the user says yes. If they asked for a change in the same breath ("rename profile X to Y"), that is still not approval of the JSON you produced — show it, then ask. When a change is large or destructive, suggest they back up first via [More]->[Export Config].

**⚠️ Nothing enforces this.** The app cannot make you ask, and nothing in MCP can — the user is trusting the instruction. Honour it.

## Calling the User's Hack Functions 🧪

Each entry of `reusableHackFunctions` is a two-element array where **element `[0]` is the usage comment and element `[1]` is the function body** (see [Hack Function](#hack-function-)). Call `list_hack_functions` and you get exactly that comment back, so you know the real signature instead of guessing — including the three built-ins shipped in the factory configuration:

*   `overwriteCookiesInRequestHeaders(newCookies)` — rewrite the outgoing `Cookie` header (use in `hackRequest`)
*   `overwriteCookiesInResponseHeaders(newCookies)` — rewrite the `Set-Cookie` response header (use in `hackResponse`)
*   `overwriteRuleForPath(pathConfigMap, defaultConfig?)` — pick the upstream proxy, change the target, and/or rewrite the path prefix, all by path prefix (use in `hackRequest`)

**Use any other field of the profile in preference to `hackRequest` / `hackResponse`** — see [`hackRequest` and `hackResponse` are the last resort](#hackrequest-and-hackresponse-are-the-last-resort).

When one *is* warranted, **you must call `list_hack_functions` before you use or even suggest any `hackRequest` / `hackResponse` entry** — whether you are writing one through `manage_profile` or only proposing one in chat — and equally before you edit or remove a profile that already carries one, so you know what its existing hacks do. Never rely on a signature you remember: the user may have edited, renamed or deleted a function since.

Three details worth knowing:

*   **The user's own functions are included too,** flagged `builtIn: false`. A function that is *not* listed has been deleted from the configuration and can no longer be called from a profile — never write a rule that calls one.
*   **A function with no usage comment must not be used.** Its documentation *is* its contract, so an entry whose `[0]` is missing or empty comes back with `usage: null` and `doNotUse: true` (and its name in `doNotUseFunctions`). There is no fallback to the shipped text — an empty comment means the function is not fit to be called. Without the contract you cannot know what arguments it takes, and a guess breaks the user's traffic at runtime.
*   **If an undocumented function is the only fit,** say so: tell the user to document it in element `[0]` of its `reusableHackFunctions` entry, and propose nothing that calls it until they have.

Prefer an existing documented function over inventing new inline code.

## Writing with `manage_profile` ✍️

`manage_profile` is the only tool you have that writes to the user's configuration. It runs through exactly the same save path as the app's own editors, so the configuration is validated, saved to disk and reflected in the window just as if the user had edited it by hand.

**Before every call:** `get_usage_guide` and `get_configuration` are both mandatory, and `list_hack_functions` is mandatory whenever hacks are involved on either side of the change — see [Prerequisite calls for `manage_profile`](#prerequisite-calls-for-manage_profile). Decide which part each change belongs in — see [Where does the change belong](#where-does-the-change-belong-the-profile-or-globalsettings-). Then show the change and get approval — see [Confirm Before You Write](#confirm-before-you-write-).

**What you can and cannot touch**

*   ✅ `add` / `edit` / `remove` add, replace or delete a single entry of the `profile` array.
*   ✅ `globalSettingsJson` replaces the `others`, `substitute` and `profileSet` sections of `globalSettings` — on its own, or in the same call as a profile action.
*   ❌ Nothing else. `globalSettings.ai`, `reusableHackFunctions`, `appPort` and `configVersion` are rejected before anything is written — see [What `manage_profile` may never write](#what-manage_profile-may-never-write-). A `profileJson` carrying a configuration-root key is rejected too.
*   ⚠️ Every URL-valued field (`proxyUrl`, a fixed rule's `target` / `customizedProxy`) needs an explicit scheme — ask the user rather than guess http/https/SOCKS for a bare domain such as `new.example.com`. See [Read These Before You Advise or Act](#read-these-before-you-advise-or-act-).
*   ⚠️ A profile you write **may** contain `hackRequest` / `hackResponse` arrays calling the user's `reusableHackFunctions`. Those entries are evaluated as JavaScript when the profile starts, so treat them as code you are asking the user to run — see [Security](#security) in Part 1.

**Arguments**

| Argument             | Used by                 | Meaning                                                                                                                        |
|----------------------|-------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| `action`             | profile changes         | `"add"`, `"edit"` or `"remove"`. **Omit it** when the call changes only `globalSettings`.                                          |
| `profile`            | `edit`, `remove`        | Which profile to target: its exact name (**first match wins**) or its zero-based index.                                          |
| `profileJson`        | `add`, `edit`           | The **complete** profile object: `{ "name", "decorator"?, "toBeDecided"?, "substitute"?, "proxy" }`.                             |
| `index`              | `add`                   | Zero-based slot the new profile should occupy after insertion (`0` = first, profile count = last).                               |
| `insertAfter`        | `add`                   | Name or index of the profile the new one should follow.                                                                          |
| `insertBefore`       | `add`                   | Name or index of the profile the new one should precede.                                                                         |
| `globalSettingsJson` | optional, any call      | The sections to replace — only `others`, `substitute`, `profileSet`. Independent of `action`. See the replace semantics below.    |

Arguments that do not belong together are rejected rather than ignored: a profile argument (`profile`, `profileJson`, or a position) without an `action` is an error, since there would be no way to know what to do with it. A call carrying neither `action` nor `globalSettingsJson` is an error too. Validation of `globalSettingsJson` runs **before** any profile work, so a rejected call writes nothing at all — neither half.

**`globalSettingsJson` replaces a section in full — this is the easiest thing to get wrong**

Each section you send **overwrites the stored one entirely**; sections you omit are left untouched. So to add one key to `substitute`, take the existing `substitute` object from `get_configuration`, add your key to it, and send the whole thing:

```json
// WRONG — deletes every other substitution
{ "globalSettingsJson": { "substitute": { "newKey": "value" } } }

// RIGHT — existing keys carried over, one added
{ "globalSettingsJson": { "substitute": { "globalStgProxyHost": "http://existing:80", "newKey": "value" } } }
```

The same applies to `profileSet`: send every rule set you want to keep, not just the new one. To delete a section's contents deliberately, send `{}` for it — and say so explicitly when you ask for approval.

For `add`, give **at most one** of `index` / `insertAfter` / `insertBefore`; omit all three to append at the end. Arguments that do not belong to the chosen action are rejected rather than ignored, so a misplaced position can never silently put a profile somewhere you did not intend.

**Two things to get right**

*   `edit` **replaces the whole profile** — it is not a merge. Fields you leave out of `profileJson` are dropped. Always read `get_configuration` first, apply your changes to the existing profile object, and send the whole result back.
*   Every save **stops the running proxy**, exactly as saving from the profile editor does. It comes back up when the change allows it:
    *   editing a profile *other than* the running one → the running profile is restarted;
    *   changing `globalSettings` without an `add`/`remove` → the running profile is restarted, so the new shared rules take effect immediately;
    *   editing the *running* profile → it is restarted only if your current placeholder values still fit its new `toBeDecided`;
    *   `add` and `remove` → the proxy is left **stopped**, even when combined with a `globalSettings` change, because those renumber the profile array and restarting by the old index would start the wrong profile. Offer to `start_profile` afterwards.

`remove` deletes the profile immediately and there is no undo. Confirm the exact profile with the user, and suggest they export a backup via [More]->[Export Config] first.
