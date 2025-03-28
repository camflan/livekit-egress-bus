import timers from "node:timers/promises";
import { Chan, Select, recv } from "ts-chan";

type MsgType = "random" | "req";

type Msg = {
  type: MsgType;
  data: string;
};

const reqChannel = new Chan<Msg>();
const resChannel = new Chan<Msg>();

const abort = new AbortController();

process.once("SIGINT", function () {
  console.log("SIGINT received…");
  process.exit(0);
});

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(() => {
    abort.abort();
    process.exit(0);
  });

async function main() {
  const workers = [
    generateValues({ signal: abort.signal }),
    forwardValues({ signal: abort.signal }),
  ];

  for await (const res of resChannel) {
    console.log("RES: ", res);
  }

  // await Promise.all(workers);
}

async function forwardValues({ signal }: { signal: AbortSignal }) {
  try {
    signal.throwIfAborted();

    for await (const msg of reqChannel) {
      console.log("REQ MSG:", msg);

      if (msg.type === "req") {
        resChannel.send(msg);
      }
    }
  } catch (err) {
    console.error(err);
    return;
  }
}

async function generateValues({
  delayMs = 1500,
  signal,
}: {
  delayMs?: number;
  signal?: AbortSignal;
} = {}) {
  for await (const _ of timers.setInterval(delayMs, undefined, { signal })) {
    const now = new Date();
    const rand = Math.floor(Math.random() * 100);

    if (rand > 50) {
      reqChannel.send({
        type: "random",
        data: rand.toString(),
      });
    } else {
      reqChannel.send({
        type: "req",
        data: `Sent at ${now.toISOString()}`,
      });
    }
  }
}

// void (async function main() {
//   const ch = new Chan(1);
//   let chCount = 0;
//   let promiseImmediateResolveCount = 0;
//   let promiseDelayedResolveCount = 0;
//   let promiseRejectCount = 0;
//
//   const timeToStop = Symbol("timeToStop");
//   const catchTimeToStop = (reason) => {
//     if (reason !== timeToStop) {
//       throw reason;
//     }
//   };
//   // eslint-disable-next-line no-undef
//   const abort = new AbortController();
//
//   const workers = [
//     (async () => {
//       // eslint-disable-next-line no-constant-condition
//       while (true) {
//         await ch.send(1, abort.signal);
//       }
//     })().catch(catchTimeToStop),
//   ];
//
//   const immediateResolvedPromise = Promise.resolve("immediate");
//   const delayedResolvedPromise = new Promise((resolve) => {
//     setTimeout(() => {
//       resolve("delayed");
//     }, 10);
//   });
//   const rejectedPromise = Promise.reject("error");
//
//   const select = new Select([
//     recv(ch),
//     immediateResolvedPromise,
//     delayedResolvedPromise,
//     rejectedPromise,
//   ]);
//
//   const doIteration = async () => {
//     const result = await select.wait(abort.signal);
//     switch (result) {
//       case 0:
//         chCount++;
//         break;
//       case 1:
//         promiseImmediateResolveCount++;
//         if (select.recv(select.cases[result]).value !== "immediate") {
//           console.error("Error: Immediate promise value mismatch.");
//         }
//         break;
//       case 2:
//         promiseDelayedResolveCount++;
//         if (select.recv(select.cases[result]).value !== "delayed") {
//           console.error("Error: Delayed promise value mismatch.");
//         }
//         break;
//       case 3: {
//         promiseRejectCount++;
//         const c = select.cases[result];
//         try {
//           select.recv(c);
//           console.error("Error: Should have thrown an error.");
//         } catch (e) {
//           if (e !== "error") {
//             console.error("Error: Unexpected rejection value.");
//           }
//         }
//         break;
//       }
//       default:
//         throw new Error("unreachable");
//     }
//   };
//
//   for (let i = 0; i < 20; i++) {
//     await doIteration();
//   }
//
//   console.log("after 20 iterations:", {
//     chCount,
//     promiseImmediateResolveCount,
//     promiseDelayedResolveCount,
//     promiseRejectCount,
//   });
//
//   workers.push(
//     (async () => {
//       // eslint-disable-next-line no-constant-condition
//       while (true) {
//         await doIteration();
//       }
//     })().catch(catchTimeToStop),
//   );
//
//   await delayedResolvedPromise;
//   for (let i = 0; i < 20; i++) {
//     await new Promise((resolve) => setTimeout(resolve, 0));
//   }
//
//   console.log("just before abort:", {
//     chCount,
//     promiseImmediateResolveCount,
//     promiseDelayedResolveCount,
//     promiseRejectCount,
//   });
//
//   abort.abort(timeToStop);
//   await Promise.all(workers);
//
//   console.log("after abort:", {
//     chCount,
//     promiseImmediateResolveCount,
//     promiseDelayedResolveCount,
//     promiseRejectCount,
//   });
// })().catch((e) => {
//   process.exitCode = 1;
//   console.error("fatal error:", e);
// });

// import { select } from "@harnyk/chan";
// import { Chan } from "@harnyk/chan";
//
// type MsgType = "random" | "req";
//
// type Msg = {
//   type: MsgType;
//   data: string;
// };
//
// const reqChannel = new Chan<Msg>();
// const resChannel = new Chan<Msg>();
//
// process.once("SIGINT", function () {
//   console.log("SIGINT received…");
//   process.exit(0);
// });
//
// main()
//   .catch((err) => {
//     console.error(err);
//   })
//   .finally(() => {
//     process.exit(0);
//   });
//
// async function main() {
//   setInterval(() => {
//     const now = new Date();
//     const rand = Math.floor(Math.random() * 100);
//
//     if (rand > 50) {
//       reqChannel.send({
//         type: "random",
//         data: rand.toString(),
//       });
//     } else {
//       reqChannel.send({
//         type: "req",
//         data: `Sent at ${now.toISOString()}`,
//       });
//     }
//   }, 1500);
//
//   for await (const msg of reqChannel) {
//     console.log("REQ MSG:", msg);
//   }
//
//   await select().recv(reqChannel, ([val, ok]) => {
//     if (!ok || !val) return;
//
//     console.log("MSG: ", val);
//   });
// }
