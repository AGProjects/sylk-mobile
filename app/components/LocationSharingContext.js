// LocationSharingContext.js
//
// React context that exposes the live-location-sharing engine
// (LocationSharingManager) to any descendant of NavigationBar, so the
// location feature has a proper, idiomatic access path instead of being
// reachable only through prop-drilling or the NavigationBar ref.
//
// NavigationBar constructs the engine and provides it here (see its
// render()). Descendants that need to start/stop/pause/resume a share,
// request a peer's location, or query share state can pull the engine
// from context with the useLocationSharing() hook rather than receiving a
// long chain of callback props:
//
//     import { useLocationSharing } from './LocationSharingContext';
//     const location = useLocationSharing();
//     location.startLocationSharing(uri, durationMs, periodLabel, opts);
//
// The context value is the engine instance, which is stable for the life
// of the NavigationBar mount, so consuming it does not by itself trigger
// re-renders. Components that need to react to live share state (e.g. the
// activeLocationShares map) should continue to receive that as a prop for
// now; lifting that reactive state into a provider value is a later step.
//
// Note on the current architecture: the engine still reaches its
// component-owned state through its `host` reference (the NavigationBar
// instance). This context is the public consumer-facing seam; the
// internal host seam is what a future class-to-hook migration would
// replace. The two are intentionally separate so consumers can adopt the
// context now without waiting on that larger change.

import { createContext, useContext } from 'react';

// Default null so a missing provider is caught loudly by the hook below
// rather than silently handing out an undefined engine.
export const LocationSharingContext = createContext(null);

// Consumer hook. Throws if used outside a NavigationBar subtree so the
// mistake surfaces at development time instead of as a later
// "cannot read property of null" deep inside a handler.
export function useLocationSharing() {
    const engine = useContext(LocationSharingContext);
    if (engine == null) {
        throw new Error(
            'useLocationSharing() must be used within a NavigationBar '
            + '(LocationSharingContext.Provider) subtree.'
        );
    }
    return engine;
}

export default LocationSharingContext;
