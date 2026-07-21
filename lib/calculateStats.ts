import { getUniquePosts } from "./getUniquePosts";
import { calculatePerformance } from "./calculatePerformance";
import { calculateStatus } from "@/components/calculateStatus";

export function calculateStats(data: any[]) {

  const uniquePosts = getUniquePosts(data);

  let completed = 0;
  let pending = 0;
  let permanent = 0;
  let missed = 0;

  uniquePosts.forEach((post: any) => {

    const status = calculateStatus(post);

    switch (status) {

      case "COMPLETED":
        completed++;
        break;

      case "PERMANENT":
        permanent++;
        pending++;
        break;

      case "MISSED":
        missed++;
        pending++;
        break;

      case "ASSIGNED":
      default:
        pending++;
        break;

    }

  });

  const totalAssigned = uniquePosts.length;

  const performance = calculatePerformance(
    completed,
    totalAssigned
  );

  return {

    totalAssigned,

    completed,

    pending,

    missed,

    permanent,

    performance

  };

}