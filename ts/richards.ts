// Richards, ported from v8-v7/richards.js to typed TypeScript.
//
// The original is ES5: constructor functions plus Foo.prototype.bar = function
// assignments. bento's AOT compiler is a typed-TypeScript compiler, so it needs
// the class form and declared field types to lower a program to Go. The
// algorithm, the constants and the expected queue and hold counts are unchanged,
// so a run here does exactly the work a run of the original does.
//
// The task subclasses dispatch through an abstract run(), which is the vtable
// the original gets from the prototype chain.

const COUNT = 1000;

// These two constants specify how many times a packet is queued and how many
// times a task is put on hold in a correct run of richards. They don't have any
// meaning as such but are characteristic of a correct run, so if the actual
// queue or hold count differs there is a bug in the implementation.
const EXPECTED_QUEUE_COUNT = 2322;
const EXPECTED_HOLD_COUNT = 928;

const ID_IDLE = 0;
const ID_WORKER = 1;
const ID_HANDLER_A = 2;
const ID_HANDLER_B = 3;
const ID_DEVICE_A = 4;
const ID_DEVICE_B = 5;
const NUMBER_OF_IDS = 6;

const KIND_DEVICE = 0;
const KIND_WORK = 1;

// The task is running and is currently scheduled.
const STATE_RUNNING = 0;
// The task has packets left to process.
const STATE_RUNNABLE = 1;
// The task is not currently running. It is not blocked as such and may be
// started by the scheduler.
const STATE_SUSPENDED = 2;
// The task is blocked and cannot be run until it is explicitly released.
const STATE_HELD = 4;

const STATE_SUSPENDED_RUNNABLE = STATE_SUSPENDED | STATE_RUNNABLE;
const STATE_NOT_HELD = ~STATE_HELD;

const DATA_SIZE = 4;

// A simple package of data that is manipulated by the tasks. The exact layout of
// the payload data carried by a packet is not important, and neither is the
// nature of the work performed on packets by the tasks.
//
// Besides carrying data, packets form linked lists and are hence used both as
// data and worklists.
class Packet {
  link: Packet | null;
  id: number;
  kind: number;
  a1: number;
  a2: number[];

  constructor(link: Packet | null, id: number, kind: number) {
    this.link = link;
    this.id = id;
    this.kind = kind;
    this.a1 = 0;
    this.a2 = new Array<number>(DATA_SIZE);
  }

  // Add this packet to the end of a worklist, and return the worklist.
  addTo(queue: Packet | null): Packet {
    this.link = null;
    if (queue == null) return this;
    let next: Packet = queue;
    let peek: Packet | null = next.link;
    while (peek != null) {
      next = peek;
      peek = next.link;
    }
    next.link = this;
    return queue;
  }

  toString(): string {
    return "Packet";
  }
}

// A task is the unit of work the scheduler dispatches. The subclasses below give
// run() its four behaviours; the original reaches them through the prototype
// chain, so the abstract method here is the same dispatch.
abstract class Task {
  abstract run(packet: Packet | null): TaskControlBlock | null;
  abstract toString(): string;
}

// A task control block manages a task and the queue of work packages associated
// with it.
class TaskControlBlock {
  link: TaskControlBlock | null;
  id: number;
  priority: number;
  queue: Packet | null;
  task: Task;
  state: number;

  constructor(
    link: TaskControlBlock | null,
    id: number,
    priority: number,
    queue: Packet | null,
    task: Task,
  ) {
    this.link = link;
    this.id = id;
    this.priority = priority;
    this.queue = queue;
    this.task = task;
    if (queue == null) {
      this.state = STATE_SUSPENDED;
    } else {
      this.state = STATE_SUSPENDED_RUNNABLE;
    }
  }

  setRunning(): void {
    this.state = STATE_RUNNING;
  }

  markAsNotHeld(): void {
    this.state = this.state & STATE_NOT_HELD;
  }

  markAsHeld(): void {
    this.state = this.state | STATE_HELD;
  }

  isHeldOrSuspended(): boolean {
    return (this.state & STATE_HELD) != 0 || this.state == STATE_SUSPENDED;
  }

  markAsSuspended(): void {
    this.state = this.state | STATE_SUSPENDED;
  }

  markAsRunnable(): void {
    this.state = this.state | STATE_RUNNABLE;
  }

  // Runs this task, if it is ready to be run, and returns the next task to run.
  run(): TaskControlBlock | null {
    let packet: Packet | null;
    if (this.state == STATE_SUSPENDED_RUNNABLE) {
      packet = this.queue;
      this.queue = packet!.link;
      if (this.queue == null) {
        this.state = STATE_RUNNING;
      } else {
        this.state = STATE_RUNNABLE;
      }
    } else {
      packet = null;
    }
    return this.task.run(packet);
  }

  // Adds a packet to the worklist of this block's task, marks this as runnable
  // if necessary, and returns the next runnable object to run (the one with the
  // highest priority).
  checkPriorityAdd(task: TaskControlBlock, packet: Packet): TaskControlBlock {
    if (this.queue == null) {
      this.queue = packet;
      this.markAsRunnable();
      if (this.priority > task.priority) return this;
    } else {
      this.queue = packet.addTo(this.queue);
    }
    return task;
  }

  toString(): string {
    return "tcb { " + this.task.toString() + "@" + this.state + " }";
  }
}

// A scheduler can be used to schedule a set of tasks based on their relative
// priorities. Scheduling is done by maintaining a list of task control blocks
// which holds tasks and the data queue they are processing.
class Scheduler {
  queueCount: number;
  holdCount: number;
  blocks: (TaskControlBlock | null)[];
  list: TaskControlBlock | null;
  currentTcb: TaskControlBlock | null;
  currentId: number;

  constructor() {
    this.queueCount = 0;
    this.holdCount = 0;
    this.blocks = new Array<TaskControlBlock | null>(NUMBER_OF_IDS);
    this.list = null;
    this.currentTcb = null;
    this.currentId = -1;
  }

  addIdleTask(id: number, priority: number, queue: Packet | null, count: number): void {
    this.addRunningTask(id, priority, queue, new IdleTask(this, 1, count));
  }

  addWorkerTask(id: number, priority: number, queue: Packet | null): void {
    this.addTask(id, priority, queue, new WorkerTask(this, ID_HANDLER_A, 0));
  }

  addHandlerTask(id: number, priority: number, queue: Packet | null): void {
    this.addTask(id, priority, queue, new HandlerTask(this));
  }

  addDeviceTask(id: number, priority: number, queue: Packet | null): void {
    this.addTask(id, priority, queue, new DeviceTask(this));
  }

  // Add the specified task and mark it as running.
  addRunningTask(id: number, priority: number, queue: Packet | null, task: Task): void {
    this.addTask(id, priority, queue, task);
    this.currentTcb!.setRunning();
  }

  addTask(id: number, priority: number, queue: Packet | null, task: Task): void {
    this.currentTcb = new TaskControlBlock(this.list, id, priority, queue, task);
    this.list = this.currentTcb;
    this.blocks[id] = this.currentTcb;
  }

  // Execute the tasks managed by this scheduler.
  schedule(): void {
    this.currentTcb = this.list;
    while (this.currentTcb != null) {
      if (this.currentTcb.isHeldOrSuspended()) {
        this.currentTcb = this.currentTcb.link;
      } else {
        this.currentId = this.currentTcb.id;
        this.currentTcb = this.currentTcb.run();
      }
    }
  }

  // Release a task that is currently blocked and return the next block to run.
  release(id: number): TaskControlBlock | null {
    const tcb = this.blocks[id];
    if (tcb == null) return tcb;
    tcb.markAsNotHeld();
    if (tcb.priority > this.currentTcb!.priority) {
      return tcb;
    } else {
      return this.currentTcb;
    }
  }

  // Block the currently executing task and return the next task control block to
  // run. The blocked task will not be made runnable until it is explicitly
  // released, even if new work is added to it.
  holdCurrent(): TaskControlBlock | null {
    this.holdCount++;
    this.currentTcb!.markAsHeld();
    return this.currentTcb!.link;
  }

  // Suspend the currently executing task and return the next task control block
  // to run. If new work is added to the suspended task it will be made runnable.
  suspendCurrent(): TaskControlBlock | null {
    this.currentTcb!.markAsSuspended();
    return this.currentTcb;
  }

  // Add the specified packet to the end of the worklist used by the task
  // associated with the packet and make the task runnable if it is currently
  // suspended.
  queue(packet: Packet): TaskControlBlock | null {
    const t = this.blocks[packet.id];
    if (t == null) return t;
    this.queueCount++;
    packet.link = null;
    packet.id = this.currentId;
    return t.checkPriorityAdd(this.currentTcb!, packet);
  }
}

// An idle task doesn't do any work itself but cycles control between the two
// device tasks.
class IdleTask extends Task {
  scheduler: Scheduler;
  v1: number;
  count: number;

  constructor(scheduler: Scheduler, v1: number, count: number) {
    super();
    this.scheduler = scheduler;
    this.v1 = v1;
    this.count = count;
  }

  run(packet: Packet | null): TaskControlBlock | null {
    this.count--;
    if (this.count == 0) return this.scheduler.holdCurrent();
    if ((this.v1 & 1) == 0) {
      this.v1 = this.v1 >> 1;
      return this.scheduler.release(ID_DEVICE_A);
    } else {
      this.v1 = (this.v1 >> 1) ^ 0xd008;
      return this.scheduler.release(ID_DEVICE_B);
    }
  }

  toString(): string {
    return "IdleTask";
  }
}

// A task that suspends itself after each time it has been run to simulate
// waiting for data from an external device.
class DeviceTask extends Task {
  scheduler: Scheduler;
  v1: Packet | null;

  constructor(scheduler: Scheduler) {
    super();
    this.scheduler = scheduler;
    this.v1 = null;
  }

  run(packet: Packet | null): TaskControlBlock | null {
    if (packet == null) {
      if (this.v1 == null) return this.scheduler.suspendCurrent();
      const v = this.v1;
      this.v1 = null;
      return this.scheduler.queue(v);
    } else {
      this.v1 = packet;
      return this.scheduler.holdCurrent();
    }
  }

  toString(): string {
    return "DeviceTask";
  }
}

// A task that manipulates work packets.
class WorkerTask extends Task {
  scheduler: Scheduler;
  v1: number;
  v2: number;

  constructor(scheduler: Scheduler, v1: number, v2: number) {
    super();
    this.scheduler = scheduler;
    this.v1 = v1;
    this.v2 = v2;
  }

  run(packet: Packet | null): TaskControlBlock | null {
    if (packet == null) {
      return this.scheduler.suspendCurrent();
    } else {
      if (this.v1 == ID_HANDLER_A) {
        this.v1 = ID_HANDLER_B;
      } else {
        this.v1 = ID_HANDLER_A;
      }
      packet.id = this.v1;
      packet.a1 = 0;
      for (let i = 0; i < DATA_SIZE; i++) {
        this.v2++;
        if (this.v2 > 26) this.v2 = 1;
        packet.a2[i] = this.v2;
      }
      return this.scheduler.queue(packet);
    }
  }

  toString(): string {
    return "WorkerTask";
  }
}

// A task that manipulates work packets and then suspends itself.
class HandlerTask extends Task {
  scheduler: Scheduler;
  v1: Packet | null;
  v2: Packet | null;

  constructor(scheduler: Scheduler) {
    super();
    this.scheduler = scheduler;
    this.v1 = null;
    this.v2 = null;
  }

  run(packet: Packet | null): TaskControlBlock | null {
    if (packet != null) {
      if (packet.kind == KIND_WORK) {
        this.v1 = packet.addTo(this.v1);
      } else {
        this.v2 = packet.addTo(this.v2);
      }
    }
    if (this.v1 != null) {
      const count = this.v1.a1;
      if (count < DATA_SIZE) {
        if (this.v2 != null) {
          const v = this.v2;
          this.v2 = this.v2.link;
          v.a1 = this.v1.a2[count];
          this.v1.a1 = count + 1;
          return this.scheduler.queue(v);
        }
      } else {
        const v = this.v1;
        this.v1 = this.v1.link;
        return this.scheduler.queue(v);
      }
    }
    return this.scheduler.suspendCurrent();
  }

  toString(): string {
    return "HandlerTask";
  }
}

// The Richards benchmark simulates the task dispatcher of an operating system.
export function runRichards(): void {
  const scheduler = new Scheduler();
  scheduler.addIdleTask(ID_IDLE, 0, null, COUNT);

  let queue = new Packet(null, ID_WORKER, KIND_WORK);
  queue = new Packet(queue, ID_WORKER, KIND_WORK);
  scheduler.addWorkerTask(ID_WORKER, 1000, queue);

  queue = new Packet(null, ID_DEVICE_A, KIND_DEVICE);
  queue = new Packet(queue, ID_DEVICE_A, KIND_DEVICE);
  queue = new Packet(queue, ID_DEVICE_A, KIND_DEVICE);
  scheduler.addHandlerTask(ID_HANDLER_A, 2000, queue);

  queue = new Packet(null, ID_DEVICE_B, KIND_DEVICE);
  queue = new Packet(queue, ID_DEVICE_B, KIND_DEVICE);
  queue = new Packet(queue, ID_DEVICE_B, KIND_DEVICE);
  scheduler.addHandlerTask(ID_HANDLER_B, 3000, queue);

  scheduler.addDeviceTask(ID_DEVICE_A, 4000, null);
  scheduler.addDeviceTask(ID_DEVICE_B, 5000, null);

  scheduler.schedule();

  if (
    scheduler.queueCount != EXPECTED_QUEUE_COUNT ||
    scheduler.holdCount != EXPECTED_HOLD_COUNT
  ) {
    throw new Error(
      "Error during execution: queueCount = " +
        scheduler.queueCount +
        ", holdCount = " +
        scheduler.holdCount +
        ".",
    );
  }
}
