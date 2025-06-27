# Checkout-Proxy User Guide

## Introduction

Checkout-Proxy is a local proxy application for HTTP or HTTPS traffic. It works by dynamically generating SSL certificates for each requested domain on the fly. These certificates are signed by a custom root Certificate Authority (CA), which you need to install and trust in your operating system. This crucial step allows your browser to always validate the certificates and establish a secure connection.

This proxy also supports host mapping, allowing you to redirect requests for one domain to another with or without specifying one more remote proxy.

Additionally, there are some special features like: bypass cors restriction(experimental) and keep host header

## Install the Application
1.  **Download the Application:**
    *   Download the latest release. Choose the appropriate version for your operating system:
        *   **macOS:** `Checkout-Proxy-macOS-x64.dmg`
        *   **Windows:** `Checkout-Proxy-Windows-x64.exe`

2.  **Install the Application:**
    *   **macOS:** Open the downloaded `.dmg` file and drag the `Checkout-Proxy.app` to the Applications folder. Before you start the application for the first time, you need to run the following command in terminal: `sudo xattr -r -d com.apple.quarantine /Applications/CheckoutProxy.app` and enter your password when prompted. That's because I am not a registered Apple developer, macOS will block the application from running.
    *   **Windows:** execute `.exe` install file and follow the installation instructions. You may need to allow the application through your firewall when you start a profile of Checkout Proxy for the first time.

## Before Using
1.  **Download and Trust Root CA:**
    *   Download root CA certificate by opening [Instructions] window of this APP and then click download link on the top of the window
    *   Import `checkout-proxy-rootCA.crt` into your operating system's trusted root certificate authorities store.
        *   **macOS:** Open any command line tool. execute `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/checkout-proxy-rootCA.crt` (replace `~/Downloads/` with the actual path to the certificate). And then enter your password when prompted.
        *   **Windows:** double click `checkout-proxy-rootCA.crt` you downloaded --> click `Install Certificate` --> click `Next` --> select `Place all certificates in the following store` --> click `Browse...` --> select `Trusted Root Certification Authorities` --> click `OK` --> click `Next` --> click `Finish`. You may need to restart your browser.

2.  **Browser Configuration:**
    *   Configure your browser or system to use `127.0.0.1:8001` (replace `8001` if you've changed specified config of Checkout Proxy) as its HTTP proxy.
        *  it's recommended to use a browser extension like [FoxyProxy](https://addons.mozilla.org/en-US/firefox/addon/foxyproxy-standard/) or [SwitchyOmega](https://chromewebstore.google.com/detail/proxy-switchyomega-3-zero/pfnededegaaopdmhkdmcofjmoldfiped?pli=1).
    *   **Safari on MacOS**: you need to set both `Web Proxy (HTTP)` and `Secure Web Proxy (HTTPS)` from `System settings` -> `Wi-Fi` -> `Details` -> `Proxies`. You must set system proxy before connecting to VPN, otherwise proxy won't work properly.
    *   **Safari or Ichiba APP on IOS Simulator:** Aside from setting system proxy and connecting to VPN, You also have to add root certificate for simulator by running the following command in terminal: `xcrun simctl keychain booted add-root-cert ~/Downloads/checkout-proxy-rootCA.crt`.
           
## Using the Application
1.  **Main Window:**
    *   **Checkout-Proxy Title:** The application's name.
    *   **Buttons:**
        *   **Help:** Displays this guide.
        *   **Edit Config:** Opens a JSON editor to modify the proxy rules and profiles. Click `Save and Close` to apply.
        *   **Import Config:** Loads a configuration JSON file from your system.
        *   **Export Config:** Saves the current configuration to a file.
        *   **Direct Connect:** Start proxy server without using any fixed rule and remote proxy.
        *   **Stop:** Stops the running proxy servers using port 8001 and 8002(default).
    *   **Profile List(all available profiles from the configuration):**
        *   **Name:** The profile name.
        *   **Start:** Click to activate this profile and start/restart the proxy with its rules.
        *   **Indicator:** A light shows which profile is currently active.

## Customize Configuration File

The configuration is a JSON object with a `profile` array:

```json
{
  "configVersion": 1,  // Version of the configuration file, this filed is used for informing you in case newer configuration format is released. you should not change this value.
  "appPort": [ // you must specify two ports for this APP
    8001, // the first Port reserved for this APP, default is 8001, you should always use this port to access Checkout Proxy,
    8002  // the second Port reserved for this APP, default is 8002, you should never access this port directly
  ],
  "profile": [
    {
      "name": "9500-default", // give a name to the profile
      "proxy": {
        "proxyHost": "remote.proxy.domain",  // specify the host of remote proxy
        "proxyPort": 9500,  // specify the port of remote proxy
        "hostUsingProxy": [  // specify the the substring of the domain that you want to use remote proxy, priority : httpsFixedRule = httpFixedRule > hostBypassProxy > hostUsingProxy
          ".aaabbbb.com",
          ".ccc.ddd.com"
        ],
        "hostBypassProxy": [], // specify the substring of the domain which you don't want to use remote proxy, this has higher priority than `hostUsingProxy`
        "httpsFixedRule": { // this section is used for proxying HTTPS request to https/http target. All the rules in this section will not use remote proxy specified by proxy.proxyHost and proxy.proxyPort, if you want to use secondary proxy server, you need to specify `customizedProxy` field for each rule
          "any.https.domain:443": {  // specify the domain and port(can not omit) that you want to use fixed rule
            "target": "https://any.https.target.domain:443",  // specify the target protocal, domain and port
            "customizedProxy": "any.remote.proxy.domain:9504", // specify the secondary proxy server, if you don't want to use secondary proxy server, you can omit this field
            "keepHostHeader": true, // if you want to keep the original host header, you can set this field to true, default is false, in most of the case you don't need to set this field
            "bypassCors": true // if you want to bypass CORS restriction, you can set this field to true, default is false, it's experimental feature, you can use this feature only if you know what you are doing
          }
        },
        "httpFixedRule": { // this section is used for proxying HTTP request to https/http target. All the rules in this section will not use remote proxy specified by proxy.proxyHost and proxy.proxyPort, if you want to use secondary proxy server, you need to specify `customizedProxy` field for each rule
          "any.http.domain:8080": { // specify the domain and port(can not omit) that you want to use fixed rule
            "target": "http://any.target.domain:8080", // specify the target protocal, domain and port
            "customizedProxy": "any.remote.proxy.domain:7001",  // specify the secondary proxy server, if you don't want to use secondary proxy server, you can omit this field
            "keepHostHeader": true, // if you want to keep the original host header, you can set this field to true, default is false, in most of the case you don't need to set this field
            "bypassCors": true // if you want to bypass CORS restriction, you can set this field to true, default is false, it's experimental feature, you can use this feature only if you know what you are doing
          }
        }
      }
    }
  ]
}
```

