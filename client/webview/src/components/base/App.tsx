import Debug from 'debug';
import React, { type ReactElement } from 'react';
import ErrorBoundary from '../../notethink-views/src/components/ErrorBoundary';
import { usePendingWork } from '../../notethink-views/src/hooks/usePendingWork';
import { PendingWorkProvider } from '../../notethink-views/src/hooks/PendingWorkContext';
import ExtensionReceiver from '../ExtensionReceiver';

const debug = Debug("nodejs:notethink:App");

// owns the single usePendingWork instance so the extension-message reducer (inside ExtensionReceiver) and every downstream consumer (toolbar spinner, drawer spinners, view handlers' markPending calls) all observe and mutate the same state. Pass the hook explicitly into ExtensionReceiver and via PendingWorkProvider for the rest of the tree
function App(): ReactElement {
  const pending_work_api = usePendingWork();
  return (
    <ErrorBoundary>
      <PendingWorkProvider api={pending_work_api}>
        <ExtensionReceiver pendingWorkApi={pending_work_api} />
      </PendingWorkProvider>
    </ErrorBoundary>
  );
}

export default App;
