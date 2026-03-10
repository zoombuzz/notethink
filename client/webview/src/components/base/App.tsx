import React from 'react';
import ErrorBoundary from '../../notethink-views/src/components/ErrorBoundary';
import ExtensionReceiver from '../ExtensionReceiver';

function App() {
  return (
    <ErrorBoundary>
      <ExtensionReceiver />
    </ErrorBoundary>
  );
}

export default App;
