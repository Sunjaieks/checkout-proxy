export class FindBarComponent {
    constructor({
        searchRoot,
        matchSelector = '.json-table td',
        placeholder = 'Find in page...',
        accentColor = '#e67e22',
        parent = document.body
    } = {}) {
        this.searchRoot = searchRoot;
        this.matchSelector = matchSelector;
        this.placeholder = placeholder;
        this.parent = parent;

        this.findMatches = [];
        this.currentMatchIndex = -1;
        this.findTimeout = null;
        this.needsRefresh = false;

        this.init(accentColor);
    }

    init(accentColor) {
        this.el = document.createElement('div');
        this.el.className = 'find-bar';
        this.el.style.setProperty('--find-accent', accentColor);
        this.el.innerHTML = `
            <input type="text" class="find-input" placeholder="${this.escapeHtml(this.placeholder)}">
            <button class="find-bar-btn find-prev">▲</button>
            <button class="find-bar-btn find-next">▼</button>
            <span class="find-bar-info"></span>
            <button class="find-bar-close">✕</button>
        `;
        this.parent.appendChild(this.el);

        this.input = this.el.querySelector('.find-input');
        this.prevBtn = this.el.querySelector('.find-prev');
        this.nextBtn = this.el.querySelector('.find-next');
        this.info = this.el.querySelector('.find-bar-info');
        this.closeBtn = this.el.querySelector('.find-bar-close');

        this.input.addEventListener('input', () => {
            clearTimeout(this.findTimeout);
            this.findTimeout = setTimeout(() => {
                this.performFind(this.input.value);
            }, 400);
        });

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    this.findPrevMatch();
                } else {
                    this.findNextMatch();
                }
            } else if (e.key === 'Escape') {
                e.stopPropagation();
                this.close();
            }
        });

        this.nextBtn.addEventListener('click', () => this.findNextMatch());
        this.prevBtn.addEventListener('click', () => this.findPrevMatch());
        this.closeBtn.addEventListener('click', () => this.close());
    }

    setSearchRoot(searchRoot) {
        this.searchRoot = searchRoot;
    }

    isVisible() {
        return this.el.classList.contains('visible');
    }

    open() {
        this.el.classList.add('visible');
        this.input.focus();
        this.input.select();
        if (this.needsRefresh && this.input.value) {
            this.performFind(this.input.value);
        }
    }

    close() {
        this.el.classList.remove('visible');
        this.clearHighlights();
        this.findMatches = [];
        this.currentMatchIndex = -1;
        this.info.textContent = '';
    }

    clearHighlights() {
        if (!this.searchRoot) return;
        const highlighted = this.searchRoot.querySelectorAll('.has-highlight');
        highlighted.forEach((el) => {
            el.classList.remove('has-highlight');
            el.textContent = el.textContent;
        });
        this.searchRoot
            .querySelectorAll('.find-cell-highlight, .find-cell-highlight-current')
            .forEach((el) => el.classList.remove('find-cell-highlight', 'find-cell-highlight-current'));
    }

    performFind(searchText) {
        this.clearHighlights();
        this.findMatches = [];
        this.currentMatchIndex = -1;
        this.needsRefresh = false;

        if (!searchText || !this.searchRoot) {
            this.info.textContent = '';
            return;
        }

        const searchLower = searchText.toLowerCase();
        const elements = this.searchRoot.querySelectorAll(this.matchSelector);

        elements.forEach((el) => {
            if (el.children.length > 0) return;
            const text = el.textContent;
            if (text && text.toLowerCase().includes(searchLower)) {
                const matches = this.highlightElement(el, searchText);
                if (matches && matches.length) {
                    this.findMatches.push(...matches);
                }
            }
        });

        if (this.findMatches.length > 0) {
            this.currentMatchIndex = 0;
            this.updateCurrentMatch();
        }

        this.updateFindInfo();
    }

    highlightElement(el, searchText) {
        if (this.shouldHighlightCell(el)) {
            el.classList.add('find-cell-highlight');
            return [el];
        }

        const text = el.textContent;
        const searchLower = searchText.toLowerCase();
        const textLower = text.toLowerCase();

        let result = '';
        let lastIndex = 0;
        let index = textLower.indexOf(searchLower);

        while (index !== -1) {
            result += this.escapeHtml(text.substring(lastIndex, index));
            result += `<span class="find-highlight">${this.escapeHtml(text.substring(index, index + searchText.length))}</span>`;
            lastIndex = index + searchText.length;
            index = textLower.indexOf(searchLower, lastIndex);
        }

        result += this.escapeHtml(text.substring(lastIndex));

        el.classList.add('has-highlight');
        el.innerHTML = result;
        return Array.from(el.querySelectorAll('.find-highlight'));
    }

    updateCurrentMatch() {
        this.searchRoot.querySelectorAll('.find-highlight-current').forEach((el) => {
            el.classList.remove('find-highlight-current');
            el.classList.add('find-highlight');
        });
        this.searchRoot.querySelectorAll('.find-cell-highlight-current').forEach((el) => {
            el.classList.remove('find-cell-highlight-current');
            el.classList.add('find-cell-highlight');
        });
        if (this.findMatches.length > 0 && this.currentMatchIndex >= 0) {
            const current = this.findMatches[this.currentMatchIndex];
            if (current) {
                if (current.classList.contains('find-cell-highlight')) {
                    current.classList.remove('find-cell-highlight');
                    current.classList.add('find-cell-highlight-current');
                } else {
                    current.classList.remove('find-highlight');
                    current.classList.add('find-highlight-current');
                }
                current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    updateFindInfo() {
        if (this.findMatches.length === 0) {
            this.info.textContent = this.input.value ? 'No matches' : '';
        } else {
            this.info.textContent = `${this.currentMatchIndex + 1} / ${this.findMatches.length}`;
        }
    }

    findNextMatch() {
        if (this.needsRefresh) {
            this.performFind(this.input.value);
            this.needsRefresh = false;
        }
        if (this.findMatches.length === 0) return;
        this.currentMatchIndex = (this.currentMatchIndex + 1) % this.findMatches.length;
        this.updateCurrentMatch();
        this.updateFindInfo();
    }

    findPrevMatch() {
        if (this.needsRefresh) {
            this.performFind(this.input.value);
            this.needsRefresh = false;
        }
        if (this.findMatches.length === 0) return;
        this.currentMatchIndex = (this.currentMatchIndex - 1 + this.findMatches.length) % this.findMatches.length;
        this.updateCurrentMatch();
        this.updateFindInfo();
    }

    invalidate() {
        this.needsRefresh = true;
    }

    shouldHighlightCell(el) {
        if (!el) return false;
        if (el.classList.contains('wrap')) return false;
        return el.scrollWidth > el.clientWidth;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
