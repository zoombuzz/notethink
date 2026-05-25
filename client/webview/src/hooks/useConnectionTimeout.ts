import Debug from 'debug';
import { useCallback, useEffect, useState } from 'react';

const debug = Debug("nodejs:notethink:useConnectionTimeout");

interface ConnectionTimeoutState {
    connected: boolean;
    timed_out: boolean;
    markConnected: () => void;
}

const CONNECTION_TIMEOUT_MS = 5000;

// track whether the extension host has responded; surface a timed-out flag if it never does
export function useConnectionTimeout(initially_connected: boolean): ConnectionTimeoutState {
    const [connected, setConnected] = useState(initially_connected);
    const [timed_out, setTimedOut] = useState(false);

    // any message from the extension host proves it's alive
    const markConnected = useCallback(() => { setConnected(true); }, []);

    // show a helpful message if the extension host never responds
    useEffect(() => {
        if (connected) { return; }
        const timer = setTimeout(() => {
            debug('extension host did not respond within %dms', CONNECTION_TIMEOUT_MS);
            setTimedOut(true);
        }, CONNECTION_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [connected]);

    return { connected, timed_out, markConnected };
}
