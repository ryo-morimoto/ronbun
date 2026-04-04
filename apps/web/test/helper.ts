export { ArxivFetchScheduler } from "../src/server/do/arxiv-fetch-scheduler";

export default {
  fetch() {
    return new Response("test worker");
  },
};
