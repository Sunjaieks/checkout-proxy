function basicMarkdownToHtml(mdText) {
    // 1. Initialize state variables
    let html = '';
    const lines = mdText.split('\n');
    const listStack = []; // Use a stack to manage list nesting (type and indentation)
    let inCodeBlock = false; // State for whether we are currently inside a code block
    let codeLang = '';       // Language for the current code block (e.g., 'javascript')

    // 2. Inline parser function
    // This handles styling within a line, like bold, links, etc.
    const parseInline = (text) => {
        return text
            .replace(/!\[([^\]]+)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">') // Images
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="external-link">$1</a>') // Links
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
            .replace(/~~(.*?)~~/g, '<del>$1</del>') // Strikethrough
            // Inline code, ensuring its content is properly escaped
            .replace(/`([^`]+)`/g, (match, code) => `<code>${code.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')}</code>`);
    };

    // 3. Main parsing loop, processes line by line
    for (const line of lines) {

        // --- Core Improvement: Prioritize code block toggling ---
        // This must be checked first, as it overrides all other syntax.
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                // Found the closing fence
                html += '</code></pre>\n';
                inCodeBlock = false;
            } else {
                // Found the opening fence
                // Before entering a code block, we must close any open lists
                while (listStack.length > 0) {
                    html += `</${listStack.pop().type}>\n`;
                }
                inCodeBlock = true;
                codeLang = line.trim().substring(3).trim();
                const langClass = codeLang ? ` class="language-${codeLang}"` : '';
                html += `<pre><code${langClass}>`; // Note: No newline after the opening tags
            }
            continue; // After handling the fence, continue to the next line immediately
        }

        // If inside a code block, just append the line (escaped) and skip other parsing
        if (inCodeBlock) {
            html += line.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>') + '\n';
            continue;
        }

        // --- List Item Processing ---
        const listItemMatch = line.match(/^(\s*)(\*|-|\d+\.)\s+(.*)/);
        if (listItemMatch) {
            const indent = listItemMatch[1].length;      // Indentation of the current line
            const marker = listItemMatch[2];              // The list marker, e.g., '*', '-', or '1.'
            const content = listItemMatch[3];             // The content of the list item
            const listType = isNaN(parseInt(marker, 10)) ? 'ul' : 'ol';

            // Current line is less indented, so we're exiting nested levels.
            // Pop from stack and close tags until the indent level matches.
            while (listStack.length > 0 && indent < listStack[listStack.length - 1].indent) {
                html += `</${listStack.pop().type}>\n`;
            }

            // If needed, start a new list.
            // Condition: stack is empty, current indent is deeper, or list type has changed.
            if (listStack.length === 0 || indent > listStack[listStack.length - 1].indent || listType !== listStack[listStack.length - 1].type) {
                listStack.push({ type: listType, indent: indent });

                if (listType === 'ol') {
                    const startNum = parseInt(marker, 10);
                    // Add a 'start' attribute only if the number is greater than 1
                    const startAttr = (startNum > 1) ? ` start="${startNum}"` : '';
                    html += `<ol${startAttr}>\n`;
                } else {
                    html += '<ul>\n';
                }
            }

            // Add the list item
            html += `<li>${parseInline(content)}</li>\n`;
            continue; // After processing the list item, continue to the next line
        }

        // --- Handling non-list and non-code-block lines ---
        // Any non-list-item line will close all open lists.
        while (listStack.length > 0) {
            html += `</${listStack.pop().type}>\n`;
        }

        const trimmedLine = line.trim();
        if (trimmedLine === '') {
            continue; // If it's a blank line, just skip it.
        }

        // Headers
        const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.*)/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const content = parseInline(headerMatch[2]);
            html += `<h${level}>${content}</h${level}>\n`;
        } else {
            // Finally, treat it as a paragraph.
            html += `<p>${parseInline(trimmedLine)}</p>\n`;
        }
    }

    // 4. After the loop, close any remaining open tags
    while (listStack.length > 0) {
        html += `</${listStack.pop().type}>\n`;
    }
    if (inCodeBlock) {
        html += '</code></pre>\n';
    }
    return html;
}

async function loadHelpContent() {
    window.electronAPI.getMarkdownContent((mdContent) => {
        const markdownContentEl = document.getElementById('markdownContent');
        try{
            markdownContentEl.innerHTML = basicMarkdownToHtml(mdContent);
            // Add event listeners for external links
            document.querySelectorAll('.external-link').forEach(link => {
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    const url = link.getAttribute('href');
                    if (url) {
                        window.electronAPI.openExternalLink(url);
                    }
                });
            });
        }catch (error){
            markdownContentEl.innerHTML = `<p><strong>Error loading help content:</strong> ${error.message}</p><p>Please ensure the <code>help-content.md</code> file exists in the application directory.</p>`;
            console.error('Error in help_renderer:', error);
        }
    });
    createDownloadButton();
}

function createDownloadButton() {
    const downloadButtonContainerEl = document.getElementById('downloadButton');
    if (!downloadButtonContainerEl) {
        console.warn("Download button container not found. Button will not be added.");
        return;
    }
    downloadButtonContainerEl.addEventListener('click', (event) => {
        event.preventDefault();
        window.electronAPI.downloadRootCA();
    });
}

loadHelpContent();



