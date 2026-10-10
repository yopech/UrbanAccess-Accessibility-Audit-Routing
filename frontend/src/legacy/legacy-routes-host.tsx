import { useEffect, useRef } from 'react';
import { mountLegacyRoutes } from './mount-legacy-routes.js';
import { updateParticipants } from '../pwa/update-participants.js';
export function LegacyRoutesHost() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current) return;
    const mount = mountLegacyRoutes(root.current);
    const unregister = updateParticipants.add(mount);
    return () => { unregister(); mount.dispose(); };
  }, []);
  return <div ref={root} data-legacy-root />;
}
