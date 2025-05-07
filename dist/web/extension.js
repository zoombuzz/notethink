/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(__webpack_require__(1));
const notethinkEditor_1 = __webpack_require__(2);
function activate(context) {
    // register our editor for opening specific files in wider context
    const provider = new notethinkEditor_1.NotethinkEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(notethinkEditor_1.NotethinkEditorProvider.viewType, provider);
    context.subscriptions.push(providerRegistration);
    // register command defined in package.json
    const disposable = vscode.commands.registerCommand('notethink.openview', async () => {
        // open an editor webview (without a specific file) in a wider context
        provider.myWebviewPanel(vscode.window.createWebviewPanel('notethink', 'NoteThink', vscode.ViewColumn.One, {}));
    });
    context.subscriptions.push(disposable);
}
function deactivate() { }


/***/ }),
/* 1 */
/***/ ((module) => {

module.exports = require("vscode");

/***/ }),
/* 2 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.NotethinkEditorProvider = void 0;
const vscode = __importStar(__webpack_require__(1));
const crypto_1 = __webpack_require__(3);
const utils_1 = __webpack_require__(4);
class NotethinkEditorProvider {
    static register(context) {
        const provider = new NotethinkEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(NotethinkEditorProvider.viewType, provider);
        return providerRegistration;
    }
    constructor(context) {
        this.context = context;
        // no action
    }
    async myWebviewPanel(webviewPanel) {
        // setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        // load all matching documents in repo
        const filter_criterion = '**/docstech/**/*.md';
        const all_documents_meta_raw = await vscode.workspace.findFiles(filter_criterion);
        const load_time = new Date().toISOString();
        const docs = (await Promise.all(all_documents_meta_raw
            .map(async (uri) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const doc = {
                path: uri.path,
                id: await (0, crypto_1.generateIdentifier)(uri.path),
                content: document.getText(),
                updatedAt: load_time,
            };
            // debug('loaded matching document', abbrevDoc(doc));
            return doc;
        })))
            // convert to hashmap for rapid access
            .reduce((acc, doc) => (acc[doc.id] = doc, acc), {});
        /**
         * Update the webview content
         * @param doc optional doc to update just one document
         */
        function updateWebview(doc) {
            const message = {
                type: 'update',
                partial: { docs: (doc ? { [doc.id]: {
                            ...doc,
                            updatedAt: new Date().toISOString(),
                        } } : docs) },
            };
            console.log('updateWebview', message);
            webviewPanel.webview.postMessage(message);
        }
        // listen for new documents being created that match the glob
        const watcher = vscode.workspace.createFileSystemWatcher(filter_criterion);
        watcher.onDidCreate(async (uri) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const doc = {
                path: uri.path,
                id: await (0, crypto_1.generateIdentifier)(uri.path),
                content: document.getText(),
            };
            // add to hashmap
            docs[doc.id] = doc;
            console.log('new matching document added in the background', (0, utils_1.abbrevDoc)(doc));
            updateWebview(uri);
        });
        // listen for changes (live in this instance or background saved) to watched documents
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async (e) => {
            const uri = e.document.uri.toString();
            const document = await vscode.workspace.openTextDocument(e.document.uri);
            const name_without_protocol = decodeURI(uri.replace('file://', ''));
            const doc_id = await (0, crypto_1.generateIdentifier)(name_without_protocol);
            let doc = docs[doc_id];
            if (doc === undefined) {
                doc = docs[doc_id] = {
                    path: name_without_protocol,
                    id: doc_id,
                };
                console.log('onDidChangeTextDocument event for unknown document, adding', name_without_protocol, doc_id);
            }
            else {
                console.log('Document changed in the background', (0, utils_1.abbrevDoc)(doc));
            }
            doc.content = document.getText();
            updateWebview(doc);
        });
        // make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
        // receive message back from the webview.
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'action_name':
                    // do stuff
                    return;
            }
        });
        // first call to initialise content
        updateWebview();
    }
    /**
     * resolveCustomTextEditor
     * called when file is right clicked, then "Open With..." NoteThink
     */
    async resolveCustomTextEditor(document, webviewPanel, _token) {
        return this.myWebviewPanel(webviewPanel);
    }
    /**
     * getHtmlForWebview
     * get the static HTML used for the editor webviews
     */
    getHtmlForWebview(webview) {
        const clientDistDirectory = 'dist/client';
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, clientDistDirectory, 'app.js'));
        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, clientDistDirectory, 'reset.css'));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, clientDistDirectory, 'vscode.css'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, clientDistDirectory, 'app.css'));
        // whitelist which scripts can be run
        const nonce = (0, utils_1.getNonce)();
        return /* html */ `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet" />
				<link href="${styleVSCodeUri}" rel="stylesheet" />
				<link href="${styleMainUri}" rel="stylesheet" />

				<title>Cat Scratch</title>
			</head>
			<body>
				<div class="notes">
				</div>
				
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
    }
}
exports.NotethinkEditorProvider = NotethinkEditorProvider;
NotethinkEditorProvider.viewType = 'zoombuzz.notethink';


/***/ }),
/* 3 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.generateIdentifier = generateIdentifier;
async function generateIdentifier(message, algo = 'SHA-256') {
    return Array.from(new Uint8Array(await crypto.subtle.digest(algo, new TextEncoder().encode(message))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}


/***/ }),
/* 4 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.abbrevDoc = abbrevDoc;
exports.getNonce = getNonce;
function abbrevDoc(doc) {
    return {
        id: doc.id,
    };
}
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}


/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__(0);
/******/ 	var __webpack_export_target__ = exports;
/******/ 	for(var __webpack_i__ in __webpack_exports__) __webpack_export_target__[__webpack_i__] = __webpack_exports__[__webpack_i__];
/******/ 	if(__webpack_exports__.__esModule) Object.defineProperty(__webpack_export_target__, "__esModule", { value: true });
/******/ 	
/******/ })()
;
//# sourceMappingURL=extension.js.map