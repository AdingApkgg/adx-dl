/**
 * Shape for the header's trailing actions (search, random, settings): a square
 * icon button below md, icon + label from md up.
 *
 * Applied on top of `size="sm"` rather than by swapping to `size="icon-sm"` at
 * a breakpoint, because a size variant can't be responsive and the settings
 * trigger (`SheetTrigger asChild`) can only ever be one element. Pair it with a
 * `hidden md:inline` label span and keep the button's aria-label, which is the
 * only accessible name it has while compact.
 */
export const HEADER_ACTION_CLASS = "size-7 px-0 md:w-auto md:px-2.5 md:pl-1.5";
