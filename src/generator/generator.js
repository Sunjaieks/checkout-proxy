import {minify} from "terser";
import {parse} from "@babel/parser";

export async function compressToObject(sourceCode) {
    const ast = parse(sourceCode, {sourceType: 'module'});

    const functionsObject = {};

    for (const node of ast.program.body) {
        let functionName = null;
        let functionExpressionNode = null; // The node representing the function expression
        let commentSourceNode = node; // The node to check for leading comments

        // Case 1: `function add() {}`
        if (node.type === 'FunctionDeclaration') {
            functionName = node.id.name;
            functionExpressionNode = node; // The whole declaration will be wrapped
        }
        // Case 2: `export function add() {}`
        else if (node.type === 'ExportNamedDeclaration' && node.declaration && node.declaration.type === 'FunctionDeclaration') {
            functionName = node.declaration.id.name;
            functionExpressionNode = node.declaration;
            // The comment is attached to the export declaration, not the function itself
            commentSourceNode = node;
        }
        // Case 3: `const calc = () => {}` or `const calc = function() {}`
        else if (node.type === 'VariableDeclaration' && node.declarations[0]) {
            const decl = node.declarations[0];
            if (decl.init && (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
                functionName = decl.id.name;
                functionExpressionNode = decl.init; // The expression is the initializer
                commentSourceNode = node;
            }
        }

        if (functionName && functionExpressionNode) {
            if (functionName.startsWith('__')) {
                continue;
            }
            // 1. extract comment
            let comment = '';
            if (commentSourceNode.leadingComments && commentSourceNode.leadingComments.length > 0) {
                const commentNode = commentSourceNode.leadingComments[0];
                comment = sourceCode.slice(commentNode.start, commentNode.end);
            }

            // 2. extract function expression
            let expressionString = sourceCode.slice(functionExpressionNode.start, functionExpressionNode.end);

            // CRITICAL STEP: A function declaration `function add(){}` is a statement, not an expression.
            // We must wrap it in parentheses to convert it into an expression that can be returned.
            if (functionExpressionNode.type === 'FunctionDeclaration') {
                expressionString = `(${expressionString})`;
            }

            //    mangle: false keep variable names and function names
            //    compress: false avoid code transformation, only minify
            const result = await minify(expressionString, {
                compress: false,
                mangle: false,
                output: {
                    comments: false,
                    quote_style: 3
                },
            });
            if (result.error) throw result.error;

            functionsObject[functionName] = [comment, result.code];
        }
    }
    return functionsObject;
}

export async function restoreFromCompressedObject(compressedObject) {
    const codeParts = [];
    for (const [name, data] of Object.entries(compressedObject)) {
        const [comment, funcExpression] = Array.isArray(data) ? data : ['', data];
        let fullFunctionString = '';
        if (comment) {
            fullFunctionString += `${comment}\n`;
        }
        fullFunctionString += `const ${name} = ${funcExpression};`;
        codeParts.push(fullFunctionString);
    }

    const sampleComment1 = `/**
 * This is a sample function of how to change a request right before sending to target
 * @param {anyArgs} you can pass any args as a closure for initializing your function
 * @returns {function(requestOptions): modifiedRequestOptions} it is mandatory for nested function to return an object of modified request options 
 */`;
    const sampleExpression1 = `const __hackRequestSample = (...anyArgs) => (requestOptions) => {
  /**
   * data modal of requestOptions: 
   *       {hostname: string,  // host name of request target. e.g. 'aa.bb.com'
   *        port: string,  // port number of request target. e.g. '443'
   *        path: string,  // full path of request target, start from '/'. e.g. '/cc/dd/ee.js'
   *        method: string,  // http method of request target. e.g. 'GET'
   *        headers: object,  //  object representing a http request header. e.g. "{'origin': 'aa.bb.com'}
   *        protocol: 'http' | 'https',  // request protocol. e.g. 'https'
   *        proxyUrl: string,  // proxy url. e.g. 'http://xx.yy.com:80'
   *        timeout: number}  // a number specifying the socket timeout in milliseconds e.g. 5000
   */ 
  return requestOptions;
}`;

    const sampleComment2 = `/**
 * This is a sample function of how to change a response right before sending back to browser
 * @param {anyArgs} you can pass any args as a closure for initializing your function as closure
 * @returns {function(requestOptions, originalResponse): modifiedResponse} it is mandatory for nested function to return an object of modified response 
 */`;
    const sampleExpression2 = `const __hackResponseSample = (...anyArgs) => (requestOptions, originalResponse) => {
  /**
   * data modal of requestOptions: same as the one in function of __hackRequestSample
   * data modal of originalResponse: 
   *       {code: number,  // response http code
   *        headers: object,  //  object representing a http response header. e.g. "{'origin': 'aa.bb.com'}
   *       }
   */ 
  return originalResponse;
}`;

    return await codeParts.reduce(async (acc, cur) => {
        const result = await minify(cur, {
            compress: false,
            mangle: false,
            output: {
                beautify: true,
                comments: 'default',
                indent_level: 4,
                quote_style: 3
            },
        });
        if (result.error) throw result.error;
        return (await acc) + `${result.code}`;

    }, Promise.resolve(`${sampleComment1}\n${sampleExpression1}\n\n${sampleComment2}\n${sampleExpression2}\n\n`))
}
