/**
 * Filter Parser - Parses and evaluates filter expressions
 * Supports:
 * - Column-specific: columnName:value
 * - Global search: value (searches all columns)
 * - Logical operators: AND, OR (case-insensitive)
 * - Grouping: parentheses ()
 * - Quoted values: "value with spaces" or 'value'
 */

// Token types
export const TokenType = {
    COLUMN_VALUE: 'COLUMN_VALUE', // column:value
    COLUMN_NOT_EXISTS: 'COLUMN_NOT_EXISTS', // column: (match entries without this key or null/undefined)
    VALUE: 'VALUE', // plain value
    AND: 'AND',
    OR: 'OR',
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    EOF: 'EOF'
};

/**
 * Tokenize the filter expression
 */
export function tokenize(expression) {
    const tokens = [];
    let i = 0;

    while (i < expression.length) {
        // Skip whitespace
        if (/\s/.test(expression[i])) {
            i++;
            continue;
        }

        // Parentheses
        if (expression[i] === '(') {
            tokens.push({ type: TokenType.LPAREN });
            i++;
            continue;
        }
        if (expression[i] === ')') {
            tokens.push({ type: TokenType.RPAREN });
            i++;
            continue;
        }

        // Check for AND/OR (case-insensitive)
        const remaining = expression.slice(i);
        const andMatch = remaining.match(/^(and)\b/i);
        if (andMatch) {
            tokens.push({ type: TokenType.AND });
            i += 3;
            continue;
        }
        const orMatch = remaining.match(/^(or)\b/i);
        if (orMatch) {
            tokens.push({ type: TokenType.OR });
            i += 2;
            continue;
        }

        // Parse value (possibly with column prefix)
        let value = '';
        let inQuote = null;
        let foundColon = false;
        let wasQuoted = false; // Track if value was explicitly quoted

        while (i < expression.length) {
            const char = expression[i];

            // Handle quotes
            if ((char === '"' || char === "'") && !inQuote) {
                inQuote = char;
                wasQuoted = true;
                i++;
                continue;
            }
            if (char === inQuote) {
                inQuote = null;
                i++;
                continue;
            }

            // If not in quotes, check for special characters
            if (!inQuote) {
                // Track if we've found a colon (for column:value format)
                if (char === ':' && !foundColon) {
                    foundColon = true;
                    value += char;
                    i++;
                    // Skip whitespace after colon
                    while (i < expression.length && /\s/.test(expression[i])) {
                        i++;
                    }
                    continue;
                }

                if (/\s/.test(char)) {
                    if (!foundColon) {
                        let j = i;
                        while (j < expression.length && /\s/.test(expression[j])) {
                            j++;
                        }
                        if (expression[j] === ':') {
                            i = j;
                            continue;
                        }
                    }
                    break;
                }
                if (char === '(' || char === ')') break;

            }

            value += char;
            i++;
        }

        if (inQuote) {
            throw new Error('Unterminated quote in filter expression');
        }

        if (value) {
            // Check if it's column:value format
            const colonIndex = value.indexOf(':');
            if (colonIndex > 0 && colonIndex < value.length - 1) {
                const column = value.slice(0, colonIndex);
                let searchValue = value.slice(colonIndex + 1);
                // Trim whitespace from value
                searchValue = searchValue.trim();
                tokens.push({
                    type: TokenType.COLUMN_VALUE,
                    column: column.toLowerCase(),
                    value: searchValue,
                    matchEmpty: wasQuoted && searchValue === '' // name:"" or name:'' matches empty string
                });
            } else if (colonIndex === value.length - 1) {
                // "column:" with no value (not quoted) - match entries without this key or null/undefined
                const column = value.slice(0, colonIndex);
                if (wasQuoted) {
                    // name:"" or name:'' - match empty string value
                    tokens.push({
                        type: TokenType.COLUMN_VALUE,
                        column: column.toLowerCase(),
                        value: '',
                        matchEmpty: true
                    });
                } else {
                    // name: - match entries that don't have this key or where value is null/undefined
                    tokens.push({
                        type: TokenType.COLUMN_NOT_EXISTS,
                        column: column.toLowerCase()
                    });
                }
            } else {
                tokens.push({
                    type: TokenType.VALUE,
                    value: value.trim()
                });
            }
        }
    }

    tokens.push({ type: TokenType.EOF });
    return tokens;
}

/**
 * Parse tokens into AST
 * Grammar:
 *   expr     -> orExpr
 *   orExpr   -> andExpr (OR andExpr)*
 *   andExpr  -> primary (AND primary)*
 *   primary  -> LPAREN expr RPAREN | term
 *   term     -> COLUMN_VALUE | VALUE
 */
export class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    current() {
        return this.tokens[this.pos];
    }

    consume(type) {
        if (this.current().type === type) {
            return this.tokens[this.pos++];
        }
        throw new Error(`Expected ${type}, got ${this.current().type}`);
    }

    parse() {
        if (this.current().type === TokenType.EOF) {
            return null;
        }
        return this.orExpr();
    }

    orExpr() {
        let left = this.andExpr();

        while (this.current().type === TokenType.OR) {
            this.consume(TokenType.OR);
            const right = this.andExpr();
            left = { type: 'OR', left, right };
        }

        return left;
    }

    andExpr() {
        let left = this.primary();

        while (this.current().type === TokenType.AND) {
            this.consume(TokenType.AND);
            const right = this.primary();
            left = { type: 'AND', left, right };
        }

        // Implicit AND: consecutive terms without explicit AND
        while (
            this.current().type === TokenType.COLUMN_VALUE ||
            this.current().type === TokenType.COLUMN_NOT_EXISTS ||
            this.current().type === TokenType.VALUE ||
            this.current().type === TokenType.LPAREN
        ) {
            const right = this.primary();
            left = { type: 'AND', left, right };
        }

        return left;
    }

    primary() {
        if (this.current().type === TokenType.LPAREN) {
            this.consume(TokenType.LPAREN);
            const expr = this.orExpr();
            this.consume(TokenType.RPAREN);
            return expr;
        }

        return this.term();
    }

    term() {
        const token = this.current();

        if (token.type === TokenType.COLUMN_VALUE) {
            this.consume(TokenType.COLUMN_VALUE);
            return {
                type: 'COLUMN_MATCH',
                column: token.column,
                value: token.value,
                matchEmpty: token.matchEmpty || false
            };
        }

        if (token.type === TokenType.COLUMN_NOT_EXISTS) {
            this.consume(TokenType.COLUMN_NOT_EXISTS);
            return {
                type: 'COLUMN_NOT_EXISTS',
                column: token.column
            };
        }

        if (token.type === TokenType.VALUE) {
            this.consume(TokenType.VALUE);
            return {
                type: 'GLOBAL_MATCH',
                value: token.value
            };
        }

        throw new Error(`Unexpected token: ${token.type}`);
    }
}

/**
 * Evaluate AST against a JSON entry
 */
export function evaluate(ast, entry) {
    if (!ast) return true;

    switch (ast.type) {
        case 'AND':
            return evaluate(ast.left, entry) && evaluate(ast.right, entry);

        case 'OR':
            return evaluate(ast.left, entry) || evaluate(ast.right, entry);

        case 'COLUMN_MATCH': {
            // Find column (case-insensitive)
            const columnKey = Object.keys(entry).find((k) => k.toLowerCase() === ast.column);
            if (!columnKey) return false;

            const value = entry[columnKey];
            const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');

            // If matchEmpty is true, only match actual empty string, not null/undefined
            if (ast.matchEmpty && ast.value === '') {
                return value === '';
            }

            // Case-insensitive regex match
            try {
                const regex = new RegExp(ast.value, 'i');
                return regex.test(strValue);
            } catch {
                // If invalid regex, do literal match
                return strValue.toLowerCase().includes(ast.value.toLowerCase());
            }
        }

        case 'COLUMN_NOT_EXISTS': {
            // Match entries that don't have this key or where value is null/undefined
            const columnKey = Object.keys(entry).find((k) => k.toLowerCase() === ast.column);
            if (!columnKey) return true;
            return entry[columnKey] == null;
        }

        case 'GLOBAL_MATCH': {
            // Search all values
            for (const key of Object.keys(entry)) {
                const value = entry[key];
                const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');

                try {
                    const regex = new RegExp(ast.value, 'i');
                    if (regex.test(strValue)) return true;
                } catch {
                    if (strValue.toLowerCase().includes(ast.value.toLowerCase())) {
                        return true;
                    }
                }
            }
            return false;
        }

        default:
            return true;
    }
}

/**
 * Main filter function
 */
export function parseFilter(expression) {
    if (!expression || !expression.trim()) {
        return null;
    }

    const { ast, isValid, error } = parseFilterInfo(expression);
    if (!isValid && error) {
        console.error('Filter parse error:', error);
    }
    return isValid ? ast : null;
}

export function parseFilterInfo(expression) {
    if (!expression || !expression.trim()) {
        return { ast: null, isValid: true, error: null };
    }

    try {
        const tokens = tokenize(expression);
        const parser = new Parser(tokens);
        const ast = parser.parse();
        return { ast, isValid: true, error: null };
    } catch (e) {
        return { ast: null, isValid: false, error: e };
    }
}

export function matchesFilter(ast, entry) {
    return evaluate(ast, entry);
}
