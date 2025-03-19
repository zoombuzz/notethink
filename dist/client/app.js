// @ts-check

// Script run within the webview itself.
(function () {

	// @ts-ignore; get a reference to the VS Code webview api, to post messages back to the extension
	//
	const vscode = acquireVsCodeApi();

	const notesContainer = /** @type {HTMLElement} */ (document.querySelector('.notes'));

	const errorContainer = document.createElement('div');
	document.body.appendChild(errorContainer);
	errorContainer.className = 'error';
	errorContainer.style.display = 'none';
	const state = vscode.getState() || { docs: {} };

	/**
	 * Render the document in the webview.
	 */
	function updateContent(/** @type {any} */ docs) {
		notesContainer.style.display = '';
		errorContainer.style.display = 'none';
		notesContainer.innerHTML = '<pre>' + JSON.stringify(docs) + '</pre>';
	}

	// handle messages sent from the extension to the webview
	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'update':
				// merge partial update into state
				Object.assign(state.docs, message.partial.docs);
				// update our webview's content
				updateContent(state.docs);
				// then persist; state is returned in the call to `vscode.getState` below when a webview is reloaded.
				vscode.setState(state);
				console.log('received update', message.partial.docs, state);
				return;
		}
	});

	// Webviews are normally torn down when not visible and re-created when they become visible again.
	// State lets us save information across these re-loads
	if (state) {
		console.log('loaded state', state);
		updateContent(state.docs);
	}
}());
