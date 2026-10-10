# Meteroite

The language of pull request reviews.

## Language

### Models

**Model provider**:
The model service a Review or conversation turn runs on: the owner's ChatGPT subscription or OpenRouter.
_Avoid_: execution provider (that is the Check sandbox)

### Pull request reviews

**Review**:
An assessment of one pull request, pinned to the head and base commits it was run against.
_Avoid_: review job, review run

**Finding**:
One issue a Review reports in the pull request.
_Avoid_: comment, issue

**Finding work**:
One discussion or investigation of a Finding, run against the Review's pinned source within an owner-set time and cost cap. A Finding has at most one active Finding work at a time.
_Avoid_: job, task, interaction

**Attempt**:
One run of a Finding work. Retrying, cancelling or expiring the work ends the current Attempt.

**Lease**:
A worker's exclusive right to record progress and results for one Attempt. It ends at the Attempt's deadline, on cancellation, or when a newer Attempt starts.
_Avoid_: lock, claim

**Dispatch generation**:
Which dispatch of a Finding work is allowed to start its next Attempt.

**Check**:
A command run against the pinned source during Finding work, with its recorded outcome.

**Proposal**:
A fix for a Finding, saved as a diff against the pinned source.
_Avoid_: patch, suggestion

**Application**:
Committing a Proposal to the pull request's source branch.
_Avoid_: apply job
