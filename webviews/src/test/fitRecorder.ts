import type * as Fit from "../modules/lineage/fit";

/** Each fit the panel made, by the focus it centres on. */
export const fits: { focusId: string | undefined }[] = [];

/**
 * A `vi.mock` factory for the lineage `fit` module that records each `fitGraph` call in `fits` and still runs the
 * real fit. Every test file that runs the lineage controls suite mocks the module with it, since a mock does not
 * carry through an import of another test file.
 */
export const recordingFit = async (
  importOriginal: () => Promise<typeof Fit>,
): Promise<typeof Fit> => {
  const actual = await importOriginal();
  return {
    ...actual,
    fitGraph: (request) => {
      fits.push({ focusId: request.focusId });
      return actual.fitGraph(request);
    },
  };
};
