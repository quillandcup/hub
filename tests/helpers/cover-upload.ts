import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Uploads a cover the way a member does: open the chooser, the Upload tab, pick the file, Upload and use. */
export async function uploadCover(file: File) {
  await userEvent.click(screen.getByRole("button", { name: /Choose cover|Change cover/ }));
  await userEvent.click(await screen.findByRole("tab", { name: "Upload" }));
  await userEvent.upload(screen.getByLabelText("Image file"), file);
  await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));
}
