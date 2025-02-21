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

	/**
	 * Render the document in the webview.
	 */
	function updateContent(/** @type {string} */ text) {
		let json;
		try {
			if (!text) {
				text = '{}';
			}
			json = JSON.parse(text);
		} catch {
			notesContainer.style.display = 'none';
			errorContainer.innerText = 'Error: Document is not valid json';
			errorContainer.style.display = '';
			return;
		}
		notesContainer.style.display = '';
		errorContainer.style.display = 'none';

		notesContainer.innerHTML = JSON.stringify(json);

		// add a button
		// const addButtonContainer = document.querySelector('.add-button');
		// addButtonContainer?.querySelector('button')?.addEventListener('click', () => {
		// 	vscode.postMessage({
		// 		type: 'add'
		// 	});
		// });	
		// notesContainer.appendChild(addButtonContainer);
	}

	// Handle messages sent from the extension to the webview
	window.addEventListener('message', event => {
		const message = event.data; // The json data that the extension sent
		switch (message.type) {
			case 'update':
				const text = message.text;

				// Update our webview's content
				updateContent(text);

				// Then persist state information.
				// This state is returned in the call to `vscode.getState` below when a webview is reloaded.
				vscode.setState({ text });

				return;
		}
	});

	// Webviews are normally torn down when not visible and re-created when they become visible again.
	// State lets us save information across these re-loads
	const state = vscode.getState();
	if (state) {
		updateContent(state.text);
	}
}());
