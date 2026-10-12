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
export const HEADER_ACTION_CLASS = "size-7 px-0 xl:w-auto xl:px-2.5 xl:pl-1.5";
