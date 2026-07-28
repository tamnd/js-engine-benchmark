// Richards in Go, from the same algorithm as v8-v7/richards.js and ts/richards.ts.
//
// This is the hand-written reference: what a Go programmer would write for the
// benchmark, not a transliteration of the JavaScript. The counters and ids are
// Go ints rather than doubles, the task subclasses become one small interface,
// and the packet and control-block links are ordinary pointers. The algorithm,
// the constants and the expected queue and hold counts are the original's, so a
// run here does exactly the work a run of the JavaScript does.
package main

import (
	"fmt"
	"os"

	"github.com/tamnd/js-engine-benchmark/go/harness"
)

const count = 1000

// These two constants specify how many times a packet is queued and how many
// times a task is put on hold in a correct run of richards. They don't have any
// meaning as such but are characteristic of a correct run, so if the actual
// queue or hold count differs there is a bug in the implementation.
const (
	expectedQueueCount = 2322
	expectedHoldCount  = 928
)

const (
	idIdle = iota
	idWorker
	idHandlerA
	idHandlerB
	idDeviceA
	idDeviceB
	numberOfIDs
)

const (
	kindDevice = 0
	kindWork   = 1
)

const (
	stateRunning   = 0 // running and currently scheduled
	stateRunnable  = 1 // has packets left to process
	stateSuspended = 2 // not running, not blocked, may be started by the scheduler
	stateHeld      = 4 // blocked until explicitly released

	stateSuspendedRunnable = stateSuspended | stateRunnable
	stateNotHeld           = ^stateHeld
)

const dataSize = 4

// Packet is a simple package of data that is manipulated by the tasks. The exact
// layout of the payload is not important, and neither is the nature of the work
// performed on packets by the tasks. Besides carrying data, packets form linked
// lists and are hence used both as data and worklists.
type Packet struct {
	link *Packet
	id   int
	kind int
	a1   int
	a2   [dataSize]int
}

// addTo adds p to the end of a worklist and returns the worklist.
func (p *Packet) addTo(queue *Packet) *Packet {
	p.link = nil
	if queue == nil {
		return p
	}
	next := queue
	for next.link != nil {
		next = next.link
	}
	next.link = p
	return queue
}

// Task is the unit of work the scheduler dispatches. The four implementations
// below are what the JavaScript reaches through the prototype chain.
type Task interface {
	run(packet *Packet) *TaskControlBlock
}

// TaskControlBlock manages a task and the queue of work packages associated with
// it.
type TaskControlBlock struct {
	link     *TaskControlBlock
	id       int
	priority int
	queue    *Packet
	task     Task
	state    int
}

func newTaskControlBlock(link *TaskControlBlock, id, priority int, queue *Packet, task Task) *TaskControlBlock {
	state := stateSuspended
	if queue != nil {
		state = stateSuspendedRunnable
	}
	return &TaskControlBlock{link: link, id: id, priority: priority, queue: queue, task: task, state: state}
}

func (t *TaskControlBlock) setRunning()      { t.state = stateRunning }
func (t *TaskControlBlock) markAsNotHeld()   { t.state &= stateNotHeld }
func (t *TaskControlBlock) markAsHeld()      { t.state |= stateHeld }
func (t *TaskControlBlock) markAsSuspended() { t.state |= stateSuspended }
func (t *TaskControlBlock) markAsRunnable()  { t.state |= stateRunnable }
func (t *TaskControlBlock) heldOrSuspended() bool {
	return t.state&stateHeld != 0 || t.state == stateSuspended
}

// run runs this task, if it is ready to be run, and returns the next task to run.
func (t *TaskControlBlock) run() *TaskControlBlock {
	var packet *Packet
	if t.state == stateSuspendedRunnable {
		packet = t.queue
		t.queue = packet.link
		if t.queue == nil {
			t.state = stateRunning
		} else {
			t.state = stateRunnable
		}
	}
	return t.task.run(packet)
}

// checkPriorityAdd adds a packet to the worklist of this block's task, marks this
// as runnable if necessary, and returns the next runnable object to run (the one
// with the highest priority).
func (t *TaskControlBlock) checkPriorityAdd(task *TaskControlBlock, packet *Packet) *TaskControlBlock {
	if t.queue == nil {
		t.queue = packet
		t.markAsRunnable()
		if t.priority > task.priority {
			return t
		}
	} else {
		t.queue = packet.addTo(t.queue)
	}
	return task
}

// Scheduler schedules a set of tasks based on their relative priorities, by
// maintaining a list of task control blocks which hold tasks and the data queue
// they are processing.
type Scheduler struct {
	queueCount int
	holdCount  int
	blocks     [numberOfIDs]*TaskControlBlock
	list       *TaskControlBlock
	currentTcb *TaskControlBlock
	currentID  int
}

func newScheduler() *Scheduler {
	return &Scheduler{currentID: -1}
}

func (s *Scheduler) addIdleTask(id, priority int, queue *Packet, count int) {
	s.addRunningTask(id, priority, queue, &IdleTask{scheduler: s, v1: 1, count: count})
}

func (s *Scheduler) addWorkerTask(id, priority int, queue *Packet) {
	s.addTask(id, priority, queue, &WorkerTask{scheduler: s, v1: idHandlerA})
}

func (s *Scheduler) addHandlerTask(id, priority int, queue *Packet) {
	s.addTask(id, priority, queue, &HandlerTask{scheduler: s})
}

func (s *Scheduler) addDeviceTask(id, priority int, queue *Packet) {
	s.addTask(id, priority, queue, &DeviceTask{scheduler: s})
}

// addRunningTask adds the specified task and marks it as running.
func (s *Scheduler) addRunningTask(id, priority int, queue *Packet, task Task) {
	s.addTask(id, priority, queue, task)
	s.currentTcb.setRunning()
}

func (s *Scheduler) addTask(id, priority int, queue *Packet, task Task) {
	s.currentTcb = newTaskControlBlock(s.list, id, priority, queue, task)
	s.list = s.currentTcb
	s.blocks[id] = s.currentTcb
}

// schedule executes the tasks managed by this scheduler.
func (s *Scheduler) schedule() {
	s.currentTcb = s.list
	for s.currentTcb != nil {
		if s.currentTcb.heldOrSuspended() {
			s.currentTcb = s.currentTcb.link
		} else {
			s.currentID = s.currentTcb.id
			s.currentTcb = s.currentTcb.run()
		}
	}
}

// release releases a task that is currently blocked and returns the next block to
// run.
func (s *Scheduler) release(id int) *TaskControlBlock {
	tcb := s.blocks[id]
	if tcb == nil {
		return nil
	}
	tcb.markAsNotHeld()
	if tcb.priority > s.currentTcb.priority {
		return tcb
	}
	return s.currentTcb
}

// holdCurrent blocks the currently executing task and returns the next task
// control block to run. The blocked task will not be made runnable until it is
// explicitly released, even if new work is added to it.
func (s *Scheduler) holdCurrent() *TaskControlBlock {
	s.holdCount++
	s.currentTcb.markAsHeld()
	return s.currentTcb.link
}

// suspendCurrent suspends the currently executing task and returns the next task
// control block to run. If new work is added to the suspended task it will be
// made runnable.
func (s *Scheduler) suspendCurrent() *TaskControlBlock {
	s.currentTcb.markAsSuspended()
	return s.currentTcb
}

// queue adds the specified packet to the end of the worklist used by the task
// associated with the packet and makes the task runnable if it is currently
// suspended.
func (s *Scheduler) queue(packet *Packet) *TaskControlBlock {
	t := s.blocks[packet.id]
	if t == nil {
		return nil
	}
	s.queueCount++
	packet.link = nil
	packet.id = s.currentID
	return t.checkPriorityAdd(s.currentTcb, packet)
}

// IdleTask doesn't do any work itself but cycles control between the two device
// tasks.
type IdleTask struct {
	scheduler *Scheduler
	v1        int
	count     int
}

func (t *IdleTask) run(packet *Packet) *TaskControlBlock {
	t.count--
	if t.count == 0 {
		return t.scheduler.holdCurrent()
	}
	if t.v1&1 == 0 {
		t.v1 >>= 1
		return t.scheduler.release(idDeviceA)
	}
	t.v1 = (t.v1 >> 1) ^ 0xd008
	return t.scheduler.release(idDeviceB)
}

// DeviceTask suspends itself after each time it has been run, to simulate waiting
// for data from an external device.
type DeviceTask struct {
	scheduler *Scheduler
	v1        *Packet
}

func (t *DeviceTask) run(packet *Packet) *TaskControlBlock {
	if packet == nil {
		if t.v1 == nil {
			return t.scheduler.suspendCurrent()
		}
		v := t.v1
		t.v1 = nil
		return t.scheduler.queue(v)
	}
	t.v1 = packet
	return t.scheduler.holdCurrent()
}

// WorkerTask manipulates work packets.
type WorkerTask struct {
	scheduler *Scheduler
	v1        int
	v2        int
}

func (t *WorkerTask) run(packet *Packet) *TaskControlBlock {
	if packet == nil {
		return t.scheduler.suspendCurrent()
	}
	if t.v1 == idHandlerA {
		t.v1 = idHandlerB
	} else {
		t.v1 = idHandlerA
	}
	packet.id = t.v1
	packet.a1 = 0
	for i := 0; i < dataSize; i++ {
		t.v2++
		if t.v2 > 26 {
			t.v2 = 1
		}
		packet.a2[i] = t.v2
	}
	return t.scheduler.queue(packet)
}

// HandlerTask manipulates work packets and then suspends itself.
type HandlerTask struct {
	scheduler *Scheduler
	v1        *Packet
	v2        *Packet
}

func (t *HandlerTask) run(packet *Packet) *TaskControlBlock {
	if packet != nil {
		if packet.kind == kindWork {
			t.v1 = packet.addTo(t.v1)
		} else {
			t.v2 = packet.addTo(t.v2)
		}
	}
	if t.v1 != nil {
		count := t.v1.a1
		if count < dataSize {
			if t.v2 != nil {
				v := t.v2
				t.v2 = t.v2.link
				v.a1 = t.v1.a2[count]
				t.v1.a1 = count + 1
				return t.scheduler.queue(v)
			}
		} else {
			v := t.v1
			t.v1 = t.v1.link
			return t.scheduler.queue(v)
		}
	}
	return t.scheduler.suspendCurrent()
}

// runRichards simulates the task dispatcher of an operating system.
func runRichards() {
	scheduler := newScheduler()
	scheduler.addIdleTask(idIdle, 0, nil, count)

	queue := &Packet{id: idWorker, kind: kindWork}
	queue = &Packet{link: queue, id: idWorker, kind: kindWork}
	scheduler.addWorkerTask(idWorker, 1000, queue)

	queue = &Packet{id: idDeviceA, kind: kindDevice}
	queue = &Packet{link: queue, id: idDeviceA, kind: kindDevice}
	queue = &Packet{link: queue, id: idDeviceA, kind: kindDevice}
	scheduler.addHandlerTask(idHandlerA, 2000, queue)

	queue = &Packet{id: idDeviceB, kind: kindDevice}
	queue = &Packet{link: queue, id: idDeviceB, kind: kindDevice}
	queue = &Packet{link: queue, id: idDeviceB, kind: kindDevice}
	scheduler.addHandlerTask(idHandlerB, 3000, queue)

	scheduler.addDeviceTask(idDeviceA, 4000, nil)
	scheduler.addDeviceTask(idDeviceB, 5000, nil)

	scheduler.schedule()

	if scheduler.queueCount != expectedQueueCount || scheduler.holdCount != expectedHoldCount {
		fmt.Fprintf(os.Stderr, "Error during execution: queueCount = %d, holdCount = %d.\n",
			scheduler.queueCount, scheduler.holdCount)
		os.Exit(1)
	}
}

func main() {
	harness.Run("Richards", 35302, nil, runRichards, nil)
}
