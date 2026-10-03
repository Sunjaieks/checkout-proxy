import { parseFilter, parseFilterInfo, matchesFilter, tokenize, TokenType } from '../filter-parser.js';

describe('Filter Parser', () => {
    // Sample test data
    const entries = [
        {
            timestamp: '2024-01-15T10:30:00Z',
            host: 'api.example.com',
            method: 'GET',
            path: '/users/123',
            protocol: 'https',
            port: 443,
            headers: '{"Content-Type":"application/json"}'
        },
        {
            timestamp: '2024-01-15T10:31:00Z',
            host: 'api.test.com',
            method: 'POST',
            path: '/login',
            protocol: 'http',
            port: 80,
            headers: '{"Authorization":"Bearer token123"}'
        },
        {
            timestamp: '2024-01-15T10:32:00Z',
            host: 'cdn.example.com',
            method: 'GET',
            path: '/images/logo.png',
            protocol: 'https',
            port: 443,
            headers: '{}'
        }
    ];

    describe('Tokenizer', () => {
        test('tokenizes simple value', () => {
            const tokens = tokenize('hello');
            expect(tokens[0]).toEqual({ type: TokenType.VALUE, value: 'hello' });
        });

        test('tokenizes column:value', () => {
            const tokens = tokenize('host:example');
            expect(tokens[0]).toEqual({
                type: TokenType.COLUMN_VALUE,
                column: 'host',
                value: 'example',
                matchEmpty: false
            });
        });

        test('tokenizes AND operator (case-insensitive)', () => {
            const tokens = tokenize('a AND b');
            expect(tokens[1].type).toBe(TokenType.AND);

            const tokens2 = tokenize('a and b');
            expect(tokens2[1].type).toBe(TokenType.AND);
        });

        test('tokenizes OR operator (case-insensitive)', () => {
            const tokens = tokenize('a OR b');
            expect(tokens[1].type).toBe(TokenType.OR);

            const tokens2 = tokenize('a or b');
            expect(tokens2[1].type).toBe(TokenType.OR);
        });

        test('tokenizes parentheses', () => {
            const tokens = tokenize('(a OR b)');
            expect(tokens[0].type).toBe(TokenType.LPAREN);
            expect(tokens[4].type).toBe(TokenType.RPAREN);
        });

        test('tokenizes quoted values with spaces', () => {
            const tokens = tokenize('path:"hello world"');
            expect(tokens[0]).toEqual({
                type: TokenType.COLUMN_VALUE,
                column: 'path',
                value: 'hello world',
                matchEmpty: false
            });
        });

        test('tokenizes single-quoted values', () => {
            const tokens = tokenize("method:'GET POST'");
            expect(tokens[0].value).toBe('GET POST');
        });

        test('column name is case-insensitive', () => {
            const tokens = tokenize('HOST:example');
            expect(tokens[0].column).toBe('host');
        });

        test('trims whitespace from value', () => {
            const tokens = tokenize('host:  example  ');
            expect(tokens[0].value).toBe('example');
        });

        test('ignores whitespace before colon in column:value', () => {
            const tokens = tokenize('host : example');
            expect(tokens[0]).toEqual({
                type: TokenType.COLUMN_VALUE,
                column: 'host',
                value: 'example',
                matchEmpty: false
            });
        });

        test('does not split plain words containing "or" or "and"', () => {
            const tokens = tokenize('error');
            expect(tokens[0]).toEqual({ type: TokenType.VALUE, value: 'error' });

            const tokens2 = tokenize('status:or');
            expect(tokens2[0]).toEqual({
                type: TokenType.COLUMN_VALUE,
                column: 'status',
                value: 'or',
                matchEmpty: false
            });
        });
    });

    describe('Column-specific filtering', () => {
        test('matches exact column value', () => {
            const ast = parseFilter('method:GET');
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[1])).toBe(false);
        });

        test('column name is case-insensitive', () => {
            const ast = parseFilter('METHOD:GET');
            expect(matchesFilter(ast, entries[0])).toBe(true);

            const ast2 = parseFilter('Host:example');
            expect(matchesFilter(ast2, entries[0])).toBe(true);
        });

        test('value supports regex', () => {
            const ast = parseFilter('host:.*example.*');
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[2])).toBe(true);
            expect(matchesFilter(ast, entries[1])).toBe(false);
        });

        test('matches partial value', () => {
            const ast = parseFilter('path:users');
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[1])).toBe(false);
        });

        test('non-existent column returns false', () => {
            const ast = parseFilter('nonexistent:value');
            expect(matchesFilter(ast, entries[0])).toBe(false);
        });
    });

    describe('Global filtering (all columns)', () => {
        test('searches all column values', () => {
            const ast = parseFilter('example');
            expect(matchesFilter(ast, entries[0])).toBe(true); // host contains example
            expect(matchesFilter(ast, entries[2])).toBe(true); // host contains example
            expect(matchesFilter(ast, entries[1])).toBe(false);
        });

        test('matches in headers JSON', () => {
            const ast = parseFilter('Bearer');
            expect(matchesFilter(ast, entries[1])).toBe(true);
            expect(matchesFilter(ast, entries[0])).toBe(false);
        });

        test('matches plain text containing "error"', () => {
            const entry = { message: 'proxy error happened' };
            const ast = parseFilter('error');
            expect(matchesFilter(ast, entry)).toBe(true);
        });
    });

    describe('AND operator', () => {
        test('explicit AND', () => {
            const ast = parseFilter('method:GET AND host:example');
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[2])).toBe(true);
            expect(matchesFilter(ast, entries[1])).toBe(false);
        });

        test('implicit AND (space-separated)', () => {
            const ast = parseFilter('method:GET host:example');
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[1])).toBe(false);
        });

        test('multiple AND conditions', () => {
            const ast = parseFilter('method:GET AND host:api AND port:443');
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[2])).toBe(false); // host is cdn
        });
    });

    describe('OR operator', () => {
        test('basic OR', () => {
            const ast = parseFilter('method:GET OR method:POST');
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[1])).toBe(true);
        });

        test('OR with different columns', () => {
            const ast = parseFilter('host:test OR path:logo');
            expect(matchesFilter(ast, entries[1])).toBe(true); // host matches
            expect(matchesFilter(ast, entries[2])).toBe(true); // path matches
            expect(matchesFilter(ast, entries[0])).toBe(false);
        });
    });

    describe('Parentheses grouping', () => {
        test('(A OR B) AND C', () => {
            const ast = parseFilter('(method:GET OR method:POST) AND host:example');
            expect(matchesFilter(ast, entries[0])).toBe(true); // GET and example
            expect(matchesFilter(ast, entries[2])).toBe(true); // GET and example
            expect(matchesFilter(ast, entries[1])).toBe(false); // POST but not example
        });

        test('A AND (B OR C)', () => {
            const ast = parseFilter('protocol:https AND (host:api OR host:cdn)');
            expect(matchesFilter(ast, entries[0])).toBe(true); // https and api
            expect(matchesFilter(ast, entries[2])).toBe(true); // https and cdn
            expect(matchesFilter(ast, entries[1])).toBe(false); // http
        });

        test('nested parentheses', () => {
            const ast = parseFilter('((method:GET AND host:api) OR (method:POST AND path:login))');
            expect(matchesFilter(ast, entries[0])).toBe(true); // GET and api
            expect(matchesFilter(ast, entries[1])).toBe(true); // POST and login
            expect(matchesFilter(ast, entries[2])).toBe(false); // GET but cdn
        });

        test('complex nested expression', () => {
            const ast = parseFilter('(host:example OR host:test) AND (method:GET OR (method:POST AND path:login))');
            expect(matchesFilter(ast, entries[0])).toBe(true); // example, GET
            expect(matchesFilter(ast, entries[1])).toBe(true); // test, POST, login
            expect(matchesFilter(ast, entries[2])).toBe(true); // example, GET
        });
    });

    describe('Quoted values', () => {
        test('double-quoted value with spaces', () => {
            const ast = parseFilter('path:"/users/123"');
            expect(matchesFilter(ast, entries[0])).toBe(true);
        });

        test('single-quoted value', () => {
            const ast = parseFilter("headers:'Content-Type'");
            expect(matchesFilter(ast, entries[0])).toBe(true);
        });

        test('single-quoted value containing OR is treated as literal', () => {
            const entry = { key: 'a or a' };
            const ast = parseFilter("key:'a or a'");
            expect(matchesFilter(ast, entry)).toBe(true);
        });

        test('quoted empty string', () => {
            const ast = parseFilter('headers:"{}"');
            expect(matchesFilter(ast, entries[2])).toBe(true);
        });

        test('double-quoted empty string matches empty value', () => {
            // Entry with empty string value
            const entryWithEmpty = { name: '', value: 'test' };
            const entryWithValue = { name: 'hello', value: 'test' };
            const entryWithoutKey = { value: 'test' };

            const ast = parseFilter('name:""');
            expect(matchesFilter(ast, entryWithEmpty)).toBe(true); // name is empty string
            expect(matchesFilter(ast, entryWithValue)).toBe(false); // name has value
            expect(matchesFilter(ast, entryWithoutKey)).toBe(false); // name key doesn't exist
        });

        test('single-quoted empty string matches empty value', () => {
            const entryWithEmpty = { name: '', value: 'test' };
            const entryWithValue = { name: 'hello', value: 'test' };

            const ast = parseFilter("name:''");
            expect(matchesFilter(ast, entryWithEmpty)).toBe(true);
            expect(matchesFilter(ast, entryWithValue)).toBe(false);
        });

        test('unquoted colon vs quoted empty string difference', () => {
            const entryWithEmpty = { name: '', value: 'test' };
            const entryWithoutKey = { value: 'test' };
            const entryWithNull = { name: null, value: 'test' };
            const entryWithUndefined = { name: undefined, value: 'test' };

            // name: (unquoted) - matches entries WITHOUT 'name' key or where value is null/undefined
            const astNotExists = parseFilter('name:');
            expect(matchesFilter(astNotExists, entryWithEmpty)).toBe(false); // empty string is not null/undefined
            expect(matchesFilter(astNotExists, entryWithoutKey)).toBe(true); // no key
            expect(matchesFilter(astNotExists, entryWithNull)).toBe(true); // null value
            expect(matchesFilter(astNotExists, entryWithUndefined)).toBe(true); // undefined value

            // name:"" (quoted) - matches entries WHERE 'name' IS empty string
            const astEmptyString = parseFilter('name:""');
            expect(matchesFilter(astEmptyString, entryWithEmpty)).toBe(true); // empty string
            expect(matchesFilter(astEmptyString, entryWithoutKey)).toBe(false); // no key
            expect(matchesFilter(astEmptyString, entryWithNull)).toBe(false); // null value
            expect(matchesFilter(astEmptyString, entryWithUndefined)).toBe(false); // undefined value
        });
    });

    describe('Edge cases', () => {
        test('empty filter returns all', () => {
            const ast = parseFilter('');
            expect(ast).toBeNull();
        });

        test('whitespace-only filter returns all', () => {
            const ast = parseFilter('   ');
            expect(ast).toBeNull();
        });

        test('case-insensitive value matching', () => {
            const ast = parseFilter('method:get');
            expect(matchesFilter(ast, entries[0])).toBe(true);
        });

        test('numeric value in filter', () => {
            const ast = parseFilter('port:443');
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[1])).toBe(false);
        });

        test('column: (no value) matches entries without that key', () => {
            const ast = parseFilter('nonexistent:');
            // Should match entries that don't have 'nonexistent' key
            expect(matchesFilter(ast, entries[0])).toBe(true);
            expect(matchesFilter(ast, entries[1])).toBe(true);

            const ast2 = parseFilter('host:');
            // Should NOT match entries that have 'host' key
            expect(matchesFilter(ast2, entries[0])).toBe(false);
        });

        test('column: with whitespace matches entries without that key', () => {
            const ast = parseFilter('nonexistent:   ');
            // Whitespace after colon should also match entries without the key
            expect(matchesFilter(ast, entries[0])).toBe(true);

            const ast2 = parseFilter('host:   ');
            expect(matchesFilter(ast2, entries[0])).toBe(false);
        });

        test('special regex characters in value', () => {
            const ast = parseFilter('path:/users/');
            expect(matchesFilter(ast, entries[0])).toBe(true);
        });

        test('invalid regex falls back to literal match', () => {
            const ast = parseFilter('path:[invalid');
            // Should not throw, falls back to literal
            expect(matchesFilter(ast, entries[0])).toBe(false);
        });

        test('name:false matches both boolean false and string containing "false"', () => {
            const entryBoolFalse = { enabled: false, name: 'test' };
            const entryBoolTrue = { enabled: true, name: 'test' };
            const entryStringFalse = { enabled: 'false', name: 'test' };
            const entryStringContainsFalse = { enabled: 'value is false here', name: 'test' };
            const entryOther = { enabled: 'yes', name: 'test' };

            const ast = parseFilter('enabled:false');
            expect(matchesFilter(ast, entryBoolFalse)).toBe(true); // boolean false
            expect(matchesFilter(ast, entryStringFalse)).toBe(true); // string "false"
            expect(matchesFilter(ast, entryStringContainsFalse)).toBe(true); // string containing "false"
            expect(matchesFilter(ast, entryBoolTrue)).toBe(false); // boolean true
            expect(matchesFilter(ast, entryOther)).toBe(false); // other value
        });

        test('name:true matches both boolean true and string containing "true"', () => {
            const entryBoolTrue = { active: true, name: 'test' };
            const entryBoolFalse = { active: false, name: 'test' };
            const entryStringTrue = { active: 'true', name: 'test' };
            const entryStringContainsTrue = { active: 'set to true now', name: 'test' };
            const entryOther = { active: 'no', name: 'test' };

            const ast = parseFilter('active:true');
            expect(matchesFilter(ast, entryBoolTrue)).toBe(true); // boolean true
            expect(matchesFilter(ast, entryStringTrue)).toBe(true); // string "true"
            expect(matchesFilter(ast, entryStringContainsTrue)).toBe(true); // string containing "true"
            expect(matchesFilter(ast, entryBoolFalse)).toBe(false); // boolean false
            expect(matchesFilter(ast, entryOther)).toBe(false); // other value
        });

        test('global search with true/false matches boolean and string values', () => {
            const entryBoolFalse = { status: false };
            const entryBoolTrue = { status: true };
            const entryStringFalse = { message: 'result is false' };

            const astFalse = parseFilter('false');
            expect(matchesFilter(astFalse, entryBoolFalse)).toBe(true);
            expect(matchesFilter(astFalse, entryStringFalse)).toBe(true);
            expect(matchesFilter(astFalse, entryBoolTrue)).toBe(false);

            const astTrue = parseFilter('true');
            expect(matchesFilter(astTrue, entryBoolTrue)).toBe(true);
            expect(matchesFilter(astTrue, entryBoolFalse)).toBe(false);
        });

        test('reports invalid filters with unterminated quotes', () => {
            const result = parseFilterInfo('path:"hello');
            expect(result.isValid).toBe(false);
            expect(result.ast).toBeNull();
        });
    });

    describe('Real-world scenarios', () => {
        test('find all GET requests to example.com', () => {
            const ast = parseFilter('method:GET AND host:example');
            const results = entries.filter((e) => matchesFilter(ast, e));
            expect(results.length).toBe(2);
        });

        test('find requests with authorization header', () => {
            const ast = parseFilter('headers:Authorization');
            const results = entries.filter((e) => matchesFilter(ast, e));
            expect(results.length).toBe(1);
            expect(results[0].host).toBe('api.test.com');
        });

        test('find non-standard port requests', () => {
            const ast = parseFilter('port:80 OR port:8080');
            const results = entries.filter((e) => matchesFilter(ast, e));
            expect(results.length).toBe(1);
        });

        test('find image requests on cdn', () => {
            const ast = parseFilter('host:cdn AND path:png');
            const results = entries.filter((e) => matchesFilter(ast, e));
            expect(results.length).toBe(1);
        });
    });
});
