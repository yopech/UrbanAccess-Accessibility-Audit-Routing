import * as Primitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
export const Accordion = Primitive.Root;
export const AccordionItem = Primitive.Item;
export const AccordionContent = Primitive.Content;
export function AccordionTrigger({ children, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Header className="element-heading"><Primitive.Trigger className="element-trigger" {...props}>{children}<ChevronDown size={24} aria-hidden="true" /></Primitive.Trigger></Primitive.Header>;
}
