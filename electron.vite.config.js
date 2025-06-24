import fs from 'node:fs'
import {resolve} from 'path';
import {defineConfig, externalizeDepsPlugin} from 'electron-vite';


export default defineConfig(({command}) => {
    fs.rmSync('dist-electron', { recursive: true, force: true })
    return {
        main: {
            plugins: [externalizeDepsPlugin()],
            build: {
                minify: true,
                rollupOptions: {
                    input: {
                        main: resolve(__dirname, 'src/main/main.js')
                    }
                }
            }
        },
        preload: {
            build: {
                minify: true,
                rollupOptions: {
                    input: {
                        preload: resolve(__dirname, 'src/preload/preload.js')
                    }
                }
            }
        },
        renderer: {
            build: {
                minify: true,
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
