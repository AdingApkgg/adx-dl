/** Both dumps need explicit positive safe bounds, even when their combined size looks valid. */
export function parseDumpBounds(
  communityValue: string | number | undefined,
  umamiValue: string | number | undefined,
) {
  const community = Number(communityValue), umami = Number(umamiValue);
  const total = community + umami;
  if (
    !Number.isSafeInteger(community) || community < 1 ||
    !Number.isSafeInteger(umami) || umami < 1 ||
    !Number.isSafeInteger(total)
  ) throw new Error("STORAGE_CAPACITY_BOUND_MISSING");
  return { community, umami, total };
}
