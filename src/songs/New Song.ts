// Generated from Timeline Manager.
import { sendSequence } from "../services/sequence";
import { startSong, trigger } from "../services/trigger";
import { Animation } from "../animation/animation";
import { beats, cycle, cycleBeats } from "../time/time";
import { phase } from "../phase/phase";
import { constColor, noColor } from "../effects/coloring";
import { addEffect } from "../effects/effect";
import {
  blink,
  brightness,
  fade,
  fadeIn,
  fadeInOut,
  fadeOut,
  fadeOutIn,
  pulse,
} from "../effects/brightness";
import { elements, segment } from "../objects/elements";
import {
  all,
  center,
  even,
  left,
  odd,
  right,
  segment_all,
  segment_arc,
  segment_b1,
  segment_b2,
  segment_centric,
  segment_ind,
  segment_rand,
  segment_updown,
} from "../objects/ring-elements";
import {
  snake,
  snakeFillGrow,
  snakeHeadMove,
  snakeHeadSin,
  snakeInOut,
  snakeSlowFast,
  snakeTailShrinkGrow,
  snakeHeadSteps,
  staticSnake,
} from "../effects/motion";
import { hueShiftSin, hueShiftStartToEnd, staticHueShift } from "../effects/hue";

const newSong = async () => {
  const anim = new Animation("New Song", 120, 32.00, 0);
  anim.sync(() => {
    beats(67, 131, () => {
      elements([1], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.5888, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(70, 131, () => {
      elements([2], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.5985, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(73, 131, () => {
      elements([3], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6088, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(76, 131, () => {
      elements([4], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6185, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(79, 131, () => {
      elements([5], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6288, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(82, 131, () => {
      elements([6], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6384, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(85, 131, () => {
      elements([7], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6488, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(88, 131, () => {
      elements([8], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6584, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(91, 131, () => {
      elements([9], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6680, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(93, 131, () => {
      elements([10], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6784, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(96, 131, () => {
      elements([11], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6887, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(99, 131, () => {
      elements([12], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6983, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(131, 139, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_centric, () => {
            constColor({ hue: 0.8987, sat: 1.0000, val: 1.0000 })
          });
        });
      });
    })

    beats(139, 163, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_centric, () => {
            constColor({ hue: 0.8386, sat: 1.0000, val: 1.0000 })
          });
        });
      });
    })

    beats(163, 171, () => {
      elements(all, () => {
        segment(segment_all, () => {
          constColor({ hue: 0.5571, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(171, 179, () => {
      elements(all, () => {
        segment(segment_all, () => {
          constColor({ hue: 0.5787, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(179, 187, () => {
      elements(all, () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6245, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(187, 203, () => {
      elements(all, () => {
        segment(segment_all, () => {
          constColor({ hue: 0.5758, sat: 0.9490, val: 1.0000 })
        });
      });
    })

    beats(251, 331, () => {
      elements([6], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6311, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(255, 331, () => {
      elements([7], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6414, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(259, 331, () => {
      elements([5], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6517, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(263, 331, () => {
      elements([8], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6610, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(267, 331, () => {
      elements([4], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6704, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(271, 331, () => {
      elements([9], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6807, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(275, 331, () => {
      elements([3], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6910, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(278, 331, () => {
      elements([10], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.7004, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(282, 331, () => {
      elements([2], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.7107, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(286, 331, () => {
      elements([11], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.7210, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(290, 331, () => {
      elements([1], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.7303, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(294, 331, () => {
      elements([12], () => {
        segment(segment_all, () => {
          constColor({ hue: 0.7406, sat: 0.6980, val: 1.0000 })
        });
      });
    })

    beats(51, 67, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_all, () => {
            constColor({ hue: 0.6034, sat: 0.7602, val: 0.9647 })
          });
        });
      });
    })

    beats(0, 11, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_all, () => {
            constColor({ hue: 0.3947, sat: 0.8274, val: 0.7725 })
          });
        });
      });
    })

    beats(11, 19, () => {
      cycle(3, () => {
        elements(all, () => {
          segment(segment_all, () => {
            constColor({ hue: 0.6034, sat: 0.7602, val: 0.9647 })
          });
        });
      });
    })

    beats(19, 31, () => {
      cycle(8, () => {
        elements(all, () => {
          segment(segment_all, () => {
            constColor({ hue: 0.9177, sat: 0.6949, val: 0.9255 })
          });
        });
      });
    })

    beats(43, 51, () => {
      cycle(0.25, () => {
        elements(all, () => {
          segment(segment_all, () => {
            constColor({ hue: 0.0000, sat: 0.7155, val: 0.9373 })
          });
        });
      });
    })

    beats(203, 251, () => {
      cycle(0.25, () => {
        elements(all, () => {
          segment(segment_all, () => {
            constColor({ hue: 0.0000, sat: 0.7155, val: 0.9373 })
          });
        });
      });
    })

    beats(371, 467.58327247646866, () => {
      cycle(0.25, () => {
        elements(all, () => {
          segment(segment_all, () => {
            constColor({ hue: 0.0000, sat: 0.7155, val: 0.9373 })
          });
        });
      });
    })

    beats(31, 43, () => {
      cycle(0.25, () => {
        elements(all, () => {
          segment(segment_all, () => {
            constColor({ hue: 0.0000, sat: 0.7155, val: 0.9373 })
          });
        });
      });
    })

    beats(67, 131, () => {
      elements([1], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(70, 131, () => {
      elements([2], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(73, 131, () => {
      elements([3], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(76, 131, () => {
      elements([4], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(79, 131, () => {
      elements([5], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(82, 131, () => {
      elements([6], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(85, 131, () => {
      elements([7], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(88, 131, () => {
      elements([8], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(91, 131, () => {
      elements([9], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(93, 131, () => {
      elements([10], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(96, 131, () => {
      elements([11], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(99, 131, () => {
      elements([12], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(131, 139, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_centric, () => {
            pulse({ low: 0.256, staticPhase: 0 })
          });
        });
      });
    })

    beats(139, 163, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_centric, () => {
            pulse({ low: 0.269, staticPhase: 0 })
          });
        });
      });
    })

    beats(163, 171, () => {
      elements(all, () => {
        segment(segment_all, () => {
          fadeOutIn({ low: 0.016 })
        });
      });
    })

    beats(171, 179, () => {
      elements(all, () => {
        segment(segment_all, () => {
          fadeInOut({ high: 0.712 })
        });
      });
    })

    beats(179, 187, () => {
      elements(all, () => {
        segment(segment_all, () => {
          fadeInOut({ high: 0.875 })
        });
      });
    })

    beats(187, 203, () => {
      elements(all, () => {
        segment(segment_all, () => {
          fadeOutIn({ low: 0.242 })
        });
      });
    })

    beats(251, 331, () => {
      elements([6], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(255, 331, () => {
      elements([7], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(259, 331, () => {
      elements([5], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(263, 331, () => {
      elements([8], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(267, 331, () => {
      elements([4], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(271, 331, () => {
      elements([9], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(275, 331, () => {
      elements([3], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(278, 331, () => {
      elements([10], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(282, 331, () => {
      elements([2], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(286, 331, () => {
      elements([11], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(290, 331, () => {
      elements([1], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(294, 331, () => {
      elements([12], () => {
        segment(segment_all, () => {
          fadeIn()
        });
      });
    })

    beats(51, 67, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_all, () => {
            fadeInOut()
          });
        });
      });
    })

    beats(0, 11, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_all, () => {
            blink()
          });
        });
      });
    })

    beats(11, 19, () => {
      cycle(3, () => {
        elements(all, () => {
          segment(segment_all, () => {
            fadeInOut()
          });
        });
      });
    })

    beats(43, 51, () => {
      cycle(0.25, () => {
        elements(all, () => {
          segment(segment_all, () => {
            pulse({ low: 0.15 })
          });
        });
      });
    })

    beats(131, 139, () => {
      cycle(2, () => {
        elements(all, () => {
          segment(segment_centric, () => {
            snakeHeadSin({ tailLength: 0.414, cyclic: true })
          });
        });
      });
    })

    beats(19, 31, () => {
      cycle(8, () => {
        elements(all, () => {
          segment(segment_all, () => {
            snake({ tailLength: 0.4, cyclic: true })
          });
        });
      });
    })

    beats(203, 251, () => {
      cycle(0.25, () => {
        elements(all, () => {
          segment(segment_all, () => {
            snake({ tailLength: 0.4, cyclic: true })
          });
        });
      });
    })

    beats(371, 467.58327247646866, () => {
      cycle(0.25, () => {
        elements(all, () => {
          segment(segment_all, () => {
            snake({ tailLength: 0.4, cyclic: true })
          });
        });
      });
    })

    beats(31, 43, () => {
      cycle(0.25, () => {
        elements(all, () => {
          segment(segment_all, () => {
            snake({ tailLength: 0.4, cyclic: true })
          });
        });
      });
    })
  });

  console.log("sending sequence");
  await sendSequence("New Song", anim.getSequence());
  if (!process.env.SEND_ONLY) {
    await startSong("New Song", 0);
  }
};

(async () => {
  await newSong();
})();
