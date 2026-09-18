# HackSpain 2026 · Challenge

## Can AI manage a crisis?

What the challenge is about, what your system must do, and how it is scored. You choose the type of crisis: a wildfire, a blackout, a flood, or whatever you come up with.

| | |
|---|---|
| **Scenario** | A crisis of your choosing |
| **Environment** | Changes while the system is running |
| **Resources** | HappyRobot platform |

---

## The essentials

### Six questions your system must answer

In a crisis you never have full information, and what you know at 12:00 is already useless by 12:20. An agent that follows a fixed checklist falls behind at the first change. These are the six questions yours must answer, again and again, as the situation evolves.

#### What information matters

A hundred messages arrive and only three change anything. The system has to keep those three and discard the rest.

#### What comes first

Twenty things can be done at once, but some matter more than others. The system has to say where to start *now*.

#### Who gets notified, and when

A neighbor, a firefighter, and a decision-maker do not need the same thing. You have to decide who is called, what they are told, and in what order.

#### Where resources go

You have three ambulances and five places asking for them. Sending them one way means leaving the other waiting.

#### What happens now

It is not enough to describe how things are going. You need the next concrete action and who carries it out.

#### When to throw away the plan

The wind shifts and the plan from twenty minutes ago no longer holds. Does the system notice, or does it carry on as if nothing changed?

---

## What it must do

### Four capabilities the agent must have

#### Stay informed about what is happening

The system collects what comes in: calls, messages, sensors, APIs—whatever you have on hand.

With that, it builds a screen where you can see in two seconds what is going on and what has changed in the last few minutes.

#### Prioritize

Of everything that is open, the system says what is handled first and why—based on the resources you still have, not the ones you wish you had.

#### Coordinate the response

It notifies people, assigns tasks, and tracks who has taken what.

Calls, messages, tickets, APIs. The system *moves* things; it does not only propose them.

#### Adapt

Mid-execution something changes: a road is cut, an integration goes down, fifty more people appear.

The system is able to rebuild the plan.

---

## Requirements

### What the submission must include

| What | What it means | Status |
|---|---|---|
| **Agentic system** | Decides and acts on its own. A chatbot that answers questions does not qualify. | Required |
| **Moving scenario** | The situation changes while the system runs. If the case is static, there is nothing to adapt to. | Required |
| **Multi-step response** | A chain of actions toward a goal, not a single isolated action. | Required |
| **Real interaction** | Calls, writes, creates tickets, or moves data in a real system. Talking to a person counts. | Required |
| **Human interface** | A screen where you can understand the situation, see what the system is doing, and intervene when needed. | Required |
| **Learns from past interactions** | Reviews calls and decisions from previous runs, sees what worked and what did not, and adjusts how it acts next time. | Bonus |

---

## Evaluation

### What is judged

Three blocks: how the system decides, how it acts, and how it is supervised. None weighs more than another.

### How it decides

| Criterion | Question |
|---|---|
| **Decision** | Does it decide something sensible without having all the data? |
| **Priority** | Does it know what comes first when everything looks urgent? |
| **Adaptation** | Does it do something different when the situation changes? |

### How it acts

| Criterion | Question |
|---|---|
| **Coordination** | Does it handle people, information, and resources at the same time? |
| **Execution** | Does it execute actions outside the system, or only propose them? Calls, messages, tickets, API calls. |

### How it is supervised

| Criterion | Question |
|---|---|
| **Control** | Is it clear what the system is doing, and can someone intervene if needed? |
| **Creativity** | Does the scenario and how it is managed have something distinctive? |
| **Learning** | Extra points if it learns from previous runs. |

---

## Ideas

### Examples, if you do not have a scenario yet

These are examples from the brief, not a closed list. Anything works—including something that is not here.

| Scenario | Angle |
|---|---|
| **Wildfire** | Warn towns, move resources, and rebuild the plan every time the front turns. |
| **Widespread blackout** | No power and patchy coverage—decide who is informed and what is restored first. |
| **Armed conflict** | Move civilians and transport when half of what comes in cannot be confirmed. |
| **Flood or other natural disaster** | Timely alerts, closed roads, and teams spread across the area. |
| **Critical infrastructure failure** | A system other systems depend on goes down. What is brought back up first? |
| **Whatever you come up with** | A multi-casualty accident, a humanitarian emergency, an outbreak. The scenario is intentionally open. |

---

## What we provide

- **The HappyRobot platform.** The same one we run in production, moving thousands of interactions a day across voice, chat, email, and more.
- **The team.** We like seeing people wrestle with their own problems—that is where good ideas come from. That said, we will be at the event over the weekend if you need a hand with the platform or the scenario.
- **The demo counts as much as the system.** No matter how good what you built is, if the pitch does not bring out its value, it falls short. Put real work into the presentation and leave time to rehearse it.

---

*HappyRobot challenge for HackSpain 2026.*
