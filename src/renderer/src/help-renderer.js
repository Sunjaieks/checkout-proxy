import {HELP_WINDOW_NAME} from "../../constant/constant.js";

function basicMarkdownToHtml(mdText) {
    // 1. Initialize state variables
    let html = '';
    const lines = mdText.split('\n');
    const listStack = []; // Use a stack to manage list nesting (type and indentation)
    let inCodeBlock = false; // State for whether we are currently inside a code block
    let codeLang = '';       // Language for the current code block (e.g., 'javascript')

    // Escape HTML special characters so raw text (e.g. `<some-url>`) is not
    // swallowed by the browser as an unknown HTML tag when inserted via innerHTML.
    const escapeHtml = (text) => text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 2. Inline parser function
    // This handles styling within a line, like bold, links, etc.
    const parseInline = (text) => {
        return text
            .replace(/!\[([^\]]+)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">') // Images
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="external-link">$1</a>') // Links
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/~~(.*?)~~/g, '<del>$1</del>') // Strikethrough
            // Inline code, ensuring its content is properly escaped
            .replace(/`([^`]+)`/g, (match, code) => `<code>${escapeHtml(code)}</code>`);
    };

    // Slugify a heading the way GitHub does, so the `[text](#anchor)` links written in
    // README.md resolve against the ids we emit: lowercase, drop everything that is not a
    // word character / space / hyphen (punctuation and emoji included), spaces to hyphens.
    // A repeated heading gets a `-1`, `-2`, … suffix, again matching GitHub.
    const usedSlugs = new Map();
    const slugify = (text) => {
        const base = text
            .trim()
            .toLowerCase()
            .replace(/[^\w\s-]/gu, '')
            .replace(/\s/g, '-');
        const seen = usedSlugs.get(base);
        usedSlugs.set(base, seen === undefined ? 0 : seen + 1);
        return seen === undefined ? base : `${base}-${seen + 1}`;
    };

    // Detect a table separator row like `| --- | --- |` (dashes/colons only).
    const isTableSeparator = (text) => {
        const inner = text.trim().replace(/^\|/, '').replace(/\|$/, '');
        const cells = inner.split('|');
        return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
    };

    // Split a `| a | b |` row into trimmed cell strings.
    const splitTableRow = (text) => text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

    // 3. Main parsing loop, processes line by line
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

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
            html += escapeHtml(line) + '\n';
            continue;
        }

        // --- Table Processing ---
        // A table is a header row followed by a separator row (e.g. `| --- | --- |`).
        if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            // A table cannot live inside a list, so close any open lists first.
            while (listStack.length > 0) {
                html += `</${listStack.pop().type}>\n`;
            }

            const headerCells = splitTableRow(line);
            i++; // consume the separator row
            html += '<table>\n<thead>\n<tr>';
            for (const cell of headerCells) {
                html += `<th>${parseInline(cell)}</th>`;
            }
            html += '</tr>\n</thead>\n<tbody>\n';

            // Consume body rows: any following line that starts with `|`.
            while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
                i++;
                const cells = splitTableRow(lines[i]);
                html += '<tr>';
                for (const cell of cells) {
                    html += `<td>${parseInline(cell)}</td>`;
                }
                html += '</tr>\n';
            }

            html += '</tbody>\n</table>\n';
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
            html += `<h${level} id="${slugify(headerMatch[2])}">${content}</h${level}>\n`;
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
                    if (!url) return;
                    // A `#section` link is this guide's own table of contents, not an
                    // external URL — scroll to the heading instead of handing it to the OS.
                    if (url.startsWith('#')) {
                        const target = document.getElementById(decodeURIComponent(url.slice(1)));
                        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        return;
                    }
                    window.electronAPI.openExternalLink(url);
                });
            });
        }catch (error){
            markdownContentEl.innerHTML = `<p><strong>Error loading help content:</strong> ${error.message}</p><p>Please ensure the <code>help-content.md</code> file exists in the application directory.</p>`;
            console.error('Error in help_renderer:', error);
        }
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.electronAPI.closeWindow(HELP_WINDOW_NAME);
    }
});

loadHelpContent();



