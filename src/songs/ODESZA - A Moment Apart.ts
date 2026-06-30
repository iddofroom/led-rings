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

const oDESZAAMomentApart = async () => {
  const anim = new Animation("ODESZA - A Moment Apart", 120.19, 234.01, 0, [174,673,1184,1672,2194,2682,3181,3680,4191,4679,5178,5689,6188,6687,7187,7686,8185,8684,9183,9683,10194,10681,11180,11680,12190,12690,13177,13688,14187,14687,15186,15685,16196,16684,17194,17682,18204,18715,19191,19691,20190,20689,21188,21676,22198,22686,23197,23684,24195,24683,25182,25681,26180,26610,27179,27690,28189,28688,29187,29675,30198,30685,31184,31684,32183,32682,33181,33681,34180,34679,35178,35677,36177,36676,37175,37674,38185,38673,39184,39683,40182,40681,41181,41680,42179,42678,43178,43677,44188,44675,45186,45685,46184,46684,47183,47682,48181,48704,49203,49679,50178,50678,51177,51676,52175,52674,53174,53685,54184,54671,55182,55681,56181,56680,57179,57678,58178,58677,59176,59687,60175,60674,61173,61684,62183,62682,63181,63681,64180,64691,65190,65678,66177,66688,67187,67686,68174,68685,69184,69683,70182,70682,71181,71680,72179,72678,73178,73677,74176,74675,75186,75685,76185,76684,77183,77682,78182,78669,79180,79679,80179,80678,81177,81653,82152,82651,83151,83638,84114,84614,85148,85682,86181,86692,87203,87702,88282,88677,89165,89675,90186,90686,91162,91684,92148,92682,93182,93681,94192,94691,95190,95689,96189,96676,97187,97686,98186,98685,99161,99683,100182,100682,101181,101680,102203,102748,103201,103654,104153,104676,105186,105674,106115,106661,107114,107624,108170,108681,109180,109679,110167,110748,111293,111804,112315,112686,113186,113685,114196,114660,115113,115624,116169,116680,117180,117679,118178,118677,119176,119676,120175,120674,121173,121673,122183,122671,123182,123681,124180,124680,125179,125678,126177,126676,127176,127675,128174,128673,129173,129683,130183,130670,131181,131680,132180,132679,133178,133677,134177,134676,135175,135674,136173,136673,137172,137683,138182,138681,139169,139680,140179,140678,141177,141677,142176,142675,143174,143685,144173,144684,145171,145682,146181,146680,147180,147679,148178,148677,149177,149676,150175,150674,151174,151684,152184,152683,153170,153681,154180,154680,155179,155678,156177,156677,157176,157675,158174,158674,159173,159684,160183,160682,161181,161681,162168,162667,163178,163689,164200,164688,165187,165686,166174,166684,167184,167683,168182,168681,169181,169680,170179,170678,171178,171677,172176,172675,173174,173674,174184,174684,175183,175682,176181,176681,177180,177679,178178,178678,179177,179676,180175,180674,181185,181685,182172,182683,183182,183681,184181,184680,185179,185678,186178,186677,187176,187675,188175,188674,189173,189684,190183,190682,191181,191681,192180,192679,193178,193678,194177,194676,195175,195675,196174,196685,197184]);
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
      elements(all, () => {
        segment(segment_all, () => {
          constColor({ hue: 0.6034, sat: 0.7602, val: 0.9647 })
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
      cycle(8, () => {
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
      elements(all, () => {
        segment(segment_all, () => {
          fadeOut()
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
      cycle(8, () => {
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
  await sendSequence("ODESZA - A Moment Apart", anim.getSequence());
  if (!process.env.SEND_ONLY) {
    await startSong("ODESZA - A Moment Apart", 0);
  }
};

(async () => {
  await oDESZAAMomentApart();
})();
