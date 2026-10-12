/**
 * Below sm the header's controls get a full-width row of their own under the
 * brand: there each one stretches to an equal share, 36px tall, so the row
 * reads as one toolbar with comfortable tap targets rather than six 28px
 * squares scattered across the width. For controls that can't take
 * HEADER_ACTION_CLASS (the language switcher, the menu trigger).
 */
export const HEADER_PHONE_ROW_CLASS = "max-sm:h-9 max-sm:w-auto max-sm:flex-1";

/**
 * Shape for the header's trailing actions (search, random, notices, settings):
 * a square icon button below xl, icon + label from xl up. Labels in the widest
 * locale (en) need ~1165px of header, so anything earlier wraps the row.
 *
 * Applied on top of `size="sm"` rather than by swapping to `size="icon-sm"` at
 * a breakpoint, because a size variant can't be responsive and the settings
 * trigger (`SheetTrigger asChild`) can only ever be one element. Pair it with a
 * `hidden xl:inline` label span and keep the button's aria-label, which is the
 * only accessible name it has while compact.
 */
export const HEADER_ACTION_CLASS = `size-7 px-0 xl:w-auto xl:px-2.5 xl:pl-1.5 ${HEADER_PHONE_ROW_CLASS}`;
