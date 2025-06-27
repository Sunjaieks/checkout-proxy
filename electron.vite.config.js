import fs from 'node:fs'
import {resolve} from 'path';
import {defineConfig, externalizeDepsPlugin} from 'electron-vite';


export default defineConfig(({command, mode}) => {
    fs.rmSync('dist-electron', {recursive: true, force: true})
    const isProduction = mode === 'production' || command === 'build';
    return {
        esbuild: {
            drop: isProduction ? [] : ['console', 'debugger'],
        },
        main: {
            plugins: [externalizeDepsPlugin()],
            build: {
                minify: isProduction,
                rollupOptions: {
                    input: {
                        main: resolve(__dirname, 'src/main/main.js')
                    }
                }
            }
        },
        preload: {
            build: {
                minify: isProduction,
                rollupOptions: {
                    input: {
                        preload: resolve(__dirname, 'src/preload/preload.js')
                    }
                }
            }
        },
        renderer: {
            build: {
                minify: isProduction,
                rollupOptions: {
                    input: {
                        main: resolve(__dirname, 'src/renderer/index.html'),
                        instructions: resolve(__dirname, 'src/renderer/instructions.html'),
                        editor: resolve(__dirname, 'src/renderer/editor.html'),
                    },
                },
            },
        },
    }
});
