import type { ComponentType, ElementType } from "react";
import type { Slot } from "@/components/landing/blocks";

/**
 * A stand-in for the slot Puck hands a block that holds a list of items (a Finisher cards block's `items`): the same
 * element a slot draws (`as` and `className` honoured), with each item rendered by its own block component, in order.
 */
export function itemsSlot<P extends object>(Item: ComponentType<P>, list: Partial<P>[]): Slot {
  return function ItemsSlot({ as, className } = {}) {
    const Tag = (as ?? "div") as ElementType;
    return (
      <Tag className={className}>
        {list.map((props, i) => (
          <Item key={i} {...(props as P)} />
        ))}
      </Tag>
    );
  };
}
