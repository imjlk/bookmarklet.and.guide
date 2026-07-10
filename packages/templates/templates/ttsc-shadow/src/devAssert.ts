export const devAssert = {
  present(value: unknown, label: string): void {
    if (value === undefined || value === null) {
      throw new Error(`${label} is required`);
    }
  },
};
