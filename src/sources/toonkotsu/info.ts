import { ContentRating, SourceInfo } from "@suwatte/toolchain";
import { BASE_URL } from "./constants";

export const info: SourceInfo = {
  id: "en.poppingmango.toonkotsu",
  name: "Toonkotsu",
  version: 1,
  website: BASE_URL,
  languages: ["en"],
  rating: ContentRating.MATURE,
  thumbnail: "toonkotsu.jxl",
};
