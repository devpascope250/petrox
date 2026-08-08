export function generatingPermissions(name: string) {
  const generated = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9.]/g, "");

 const names = name
  .trim()
  .toLowerCase()
  .replace(/\b\w/g, (char) => char.toUpperCase());

  return [
    {
      code: `${generated}.read`,
      name: `View ${names}`
    },
    {
      code: `${generated}.create`,
      name: `Create ${names}`,
    },
    {
      code: `${generated}.delete`,
      name: `Delete ${names}`,
    },
    {
      code: `${generated}.edit`,
      name: `Edit ${names}`,
    },
    {
      code: `${generated}.manage`,
      name: `Manage ${names}`,
    },
  ];
}