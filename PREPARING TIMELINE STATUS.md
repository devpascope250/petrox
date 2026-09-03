# Nomination Timeline Status

## Seed data

Create idempotent seed records in `NominationTimeLineStatus`:

| Status | Level | Description |
| --- | ---: | --- |
| `awaiting` | 1 | Awaiting loading documents |
| `underLoading` | 2 | Loading in progress |
| `t1Pending` | 3 | Release in progress |
| `t1Confirmed` | 4 | Released, In transit from foreign depot to owner, In transit from border to local depot, Parked at local depot |
| `stockReceived` | 5 | Stock received |

## Nomination timeline response

- [x] Order timeline statuses by ascending `level`.
- [x] Split comma-separated descriptions into a trimmed `descriptions` array so each action can be rendered as a child of its status.
- [x] Include the date on which each status was reached.
- [x] Return the full name of the user who made the change, or `null` when no user is associated with it.

Example response item:

```json
{
  "id": "status-id",
  "status": "t1Confirmed",
  "level": 4,
  "descriptions": [
    "Released",
    "In transit from foreign depot to owner",
    "In transit from border to local depot",
    "Parked at local depot"
  ],
  "createdAt": "2026-08-22T10:00:00.000Z",
  "createdBy": "System Administrator"
}
```
