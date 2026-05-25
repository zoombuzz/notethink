import Debug from 'debug';
import React, { type ReactElement } from 'react';
import ErrorBoundary from '../../notethink-views/src/components/ErrorBoundary';
import ExtensionReceiver from '../ExtensionReceiver';

const debug = Debug("nodejs:notethink:App");

function App(): ReactElement {
  return (
    <ErrorBoundary>
      <ExtensionReceiver />
    </ErrorBoundary>
  );
}

export default App;
