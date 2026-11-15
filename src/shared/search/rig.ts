/**
 * Searching for a truck by the name people write.
 *
 * A rig is the plate **and** the trailer together — `RAB123F/TR-884` — because
 * one tractor unit is coupled to different trailers over its life and each
 * pairing is its own thing to nominate. That pair is the only name that
 * identifies one, so it is the thing people type: off a loading list, off a
 * customs document, out of a message.
 *
 * Neither column holds the slash, so a pair looked for verbatim in `platNumber`
 * matches nothing. It has to be split and matched as two halves.
 */

/** The two halves of a written rig name, or nothing if it is not one. */
export function rigParts(term: string | undefined | null) {
  const trimmed = term?.trim();
  if (!trimmed?.includes("/")) return null;
  const [plate, trailer] = trimmed.split("/", 2).map((part) => part.trim());
  // `RAB123F/` is somebody half way through typing, not a pair.
  if (!plate || !trailer) return null;
  return { plate, trailer };
}

/**
 * How a rig is named wherever one is written out: `RAB123F/TR-884`.
 *
 * Lives here beside the parsing, so the way one is written and the way one is
 * read can never drift apart.
 */
export const rigName = (platNumber: string, trailerNumber: string) =>
  `${platNumber}/${trailerNumber}`;

/**
 * Conditions matching a search term against a truck, for a `Vehicle` filter.
 *
 * A written pair becomes **both halves at once**, which is narrower and right:
 * `RAB123F/TR-884` is one rig, not everything on plate RAB123F. Anything else
 * is matched against either column on its own, so half a name still finds it.
 *
 * `prefix` nests the conditions under the path to the vehicle, for the lists
 * that reach it through a relation — `driverVehicle.vechile`, say. Returns an
 * array to splice into an `OR`.
 */
export function rigSearch(term: string, prefix?: (field: object) => object) {
  const wrap = prefix ?? ((field: object) => field);
  const pair = rigParts(term);
  if (pair) {
    return [wrap({
      platNumber: { contains: pair.plate },
      trailerNumber: { contains: pair.trailer },
    })];
  }
  return [
    wrap({ platNumber: { contains: term } }),
    wrap({ trailerNumber: { contains: term } }),
    wrap({ truckNumber: { contains: term } }),
  ];
}
