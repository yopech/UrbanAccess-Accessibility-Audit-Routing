import { BellRing, Layers } from 'lucide-react';
import entranceDoor from '../../shared/ui/icons/entrance-door.svg';
import wheelchairRamp from '../../shared/ui/icons/wheelchair-ramp.svg';
import doorThreshold from '../../shared/ui/icons/door-threshold.svg';
import stairsHandrails from '../../shared/ui/icons/stairs-handrails.svg';
import entranceLanding from '../../shared/ui/icons/entrance-landing.svg';
import accessibleRestroom from '../../shared/ui/icons/accessible-restroom.svg';

const elementIcons: Readonly<Record<string, string>> = {
  entranceDoor, door: entranceDoor, internalDoor: entranceDoor,
  ramp: wheelchairRamp, threshold: doorThreshold,
  handrails: stairsHandrails, handrail: stairsHandrails, stairs: stairsHandrails, outdoorStairs: stairsHandrails,
  entranceLanding, platform: entranceLanding,
  accessibleRestroom, toilet: accessibleRestroom, accessibleToilet: accessibleRestroom,
};
/** Decorative: the adjacent element title supplies the accessible name. */
export function ElementIcon({ elementType }: { elementType: string }) {
  const source = elementIcons[elementType];
  return <span className="element-icon-tile w-9 h-9 rounded-xl bg-zinc-100 flex items-center justify-center shrink-0" aria-hidden="true">
    {source ? <img className="element-architecture-icon object-contain" src={source} width={22} height={22} alt="" draggable={false} />
      : elementType === 'callButton' || elementType === 'call_button' ? <BellRing size={22} className="text-zinc-600" />
      : <Layers size={22} className="text-zinc-600" />}
  </span>;
}
