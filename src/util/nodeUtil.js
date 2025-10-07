import path from 'path';
import {fileURLToPath} from 'url';
import {app} from "electron";
import os from "node:os";
import * as sudo from "@vscode/sudo-prompt";
import {CERT_COMMON_NAME} from "../constant/constant";

export const getDirname = (metaUrl) => path.dirname(fileURLToPath(metaUrl));
export const getFilename = (metaUrl) => fileURLToPath(metaUrl);
export const isKeepAlive = (headers) => headers?.['connection']?.toLowerCase().trim() === 'keep-alive' || headers?.['keep-alive'] || headers?.['proxy-connection']?.toLowerCase().trim() === 'keep-alive';
export const getUserDataPath = () => app.getPath('userData');
export const rootCertPath = path.join(getUserDataPath(), 'rootCA.crt');
export const rootKeyPath = path.join(getUserDataPath(), 'rootCA.key');
export const getResourceFilePath = (fileNameStartFromAppRoot) => {
    return path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), fileNameStartFromAppRoot);
}
export const logInfo = (...message) => {
    !app.isPackaged && console.info(...message);
}
export const logError = (...message) => {
    !app.isPackaged && console.error(...message);
}
export const logWarn = (...message) => {
    !app.isPackaged && console.warn(...message);
}

export function getInstallCommand(downloadPath) {
    const platform = os.platform();
    if (platform === 'darwin') {
        const deleteCmd = `security delete-certificate -c "${CERT_COMMON_NAME}" ~/Library/Keychains/login.keychain-db 2> /dev/null || true`;
        const addCmd = `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db "${downloadPath}"`;
        return `${deleteCmd} ; ${addCmd}`;
    } else if (platform === 'win32') {
        const deleteCmd = `certutil -delstore "Root" "${CERT_COMMON_NAME}"`;
        const addCmd = `certutil -addstore -f "Root" "${downloadPath}"`;
        return `(${deleteCmd} 2>nul) & ${addCmd}`;
    }
    throw new Error('Not supported by OS.');
}

export function execute(command) {
    const platform = os.platform();
    if (platform === 'darwin') {
        return executeCommand(command)
    } else if (platform === 'win32') {
        return executeCommand(command, true)
    }
}

export function executeCommand(command, isSudo) {
    return new Promise((resolve, reject) => {
        (isSudo && sudo || require('child_process')).exec(command, {
            name: 'Checkout Proxy',
        }, (error, stdout, stderr) => {
            if (error || stderr) {
                logWarn(`Command failed to execute: ${command}`, stderr);
                reject(error || stderr);
            } else {
                resolve(stdout);
            }
        });
    });
}

export function createOsFunction(macFunction, winFunction) {
    const platform = os.platform();
    if (platform === 'darwin') {
        return macFunction
    } else if (platform === 'win32') {
        return winFunction
    }
    return () => {
    }
}

