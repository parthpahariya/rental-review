package com.boringman.rentalreview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boringman.rentalreview.data.Comment
import kotlinx.coroutines.launch

private const val MAX_COMMENT = 2000

/**
 * The public discussion under one tenant review or interaction: comments oldest
 * first. Collapsed until opened, so a flat's page loads no comments it does not show.
 */
@Composable
fun Discussion(vm: AppViewModel, onReview: Boolean, subjectId: String, initialCount: Int, onSignIn: () -> Unit) {
    val scope = rememberCoroutineScope()
    var open by rememberSaveable(subjectId) { mutableStateOf(false) }
    var count by remember(subjectId, initialCount) { mutableIntStateOf(initialCount) }
    var comments by remember(subjectId) { mutableStateOf<List<Comment>?>(null) }
    var draft by rememberSaveable(subjectId) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Comment?>(null) }
    var reporting by remember { mutableStateOf<Comment?>(null) }
    var deleting by remember { mutableStateOf<Comment?>(null) }

    suspend fun reload() {
        vm.comments(onReview, subjectId)?.let { comments = it; count = it.size }
    }
    /** Runs a change, then reloads the discussion; returns whether it worked. */
    fun change(action: suspend () -> Boolean, after: () -> Unit = {}) {
        busy = true
        scope.launch {
            if (action()) { reload(); after() }
            busy = false
        }
    }
    // Reload when the visitor signs in or out: "mine" and editing rights change.
    LaunchedEffect(open, vm.account?.id) { if (open) reload() }

    val authorLabel = if (onReview) "Wrote this review" else "Shared this interaction"
    Column(Modifier.fillMaxWidth()) {
        HorizontalDivider(color = Brand.line, modifier = Modifier.padding(top = 6.dp))
        TextButton(onClick = { open = !open }) {
            Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null, modifier = Modifier.size(16.dp), tint = Brand.ink)
            Spacer(Modifier.width(6.dp))
            Text(
                if (count > 0) "Discussion · $count ${if (count == 1) "comment" else "comments"}" else "Discuss",
                color = Brand.ink, fontWeight = FontWeight.SemiBold,
            )
            Icon(
                if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                contentDescription = if (open) "Hide discussion" else "Show discussion", tint = Brand.muted,
            )
        }
        if (!open) return@Column

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val list = comments
            when {
                list == null -> Text("Loading the discussion…", color = Brand.muted, fontSize = 13.sp)
                list.isEmpty() -> Text("No comments yet. Ask a question or add context.", color = Brand.muted, fontSize = 13.sp)
            }
            list?.forEach { c ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                        .background(if (c.mine) Brand.goldWash else Color(0xFFF8F5EF)).padding(10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (c.by_subject_author) Badge(authorLabel, Color(0xFF1D4ED8))
                        if (c.mine) Badge("You", Brand.fair)
                        Text(
                            shortDate(c.submitted_at) + if (c.edited) " · edited" else "",
                            color = Brand.muted, fontSize = 12.sp,
                        )
                    }
                    Text(c.body, color = Brand.ink, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
                    Row {
                        if (c.can_edit) TextButton(onClick = { editing = c }) { Text("Edit") }
                        if (c.mine) TextButton(onClick = { deleting = c }, enabled = !busy) { Text("Delete", color = Brand.poor) }
                        if (vm.account != null && !c.mine) TextButton(onClick = { reporting = c }) { Text("Report") }
                    }
                }
            }
            if (vm.account != null) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { if (it.length <= MAX_COMMENT) draft = it },
                    label = { Text("Add a comment") },
                    placeholder = { Text("Ask a question or add context.") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
                )
                Text(
                    "Comments are public. Stick to facts, and don’t name people or share contact details.",
                    color = Brand.muted, fontSize = 12.sp,
                )
                Button(
                    enabled = !busy && draft.isNotBlank(),
                    onClick = { change({ vm.postComment(onReview, subjectId, draft.trim()) }) { draft = "" } },
                ) { Text(if (busy) "Posting…" else "Post comment") }
            } else {
                Button(onClick = onSignIn) { Text("Sign in to join the discussion") }
            }
        }
    }

    editing?.let { c ->
        CommentDialog(
            title = "Edit your comment", label = "Comment", action = "Save", initial = c.body,
            onDismiss = { editing = null },
            onSubmit = { body -> change({ vm.editComment(c, body) }) { editing = null } },
        )
    }
    reporting?.let { c ->
        CommentDialog(
            title = "Report this comment", label = "Why should an admin review it?", action = "Send report",
            onDismiss = { reporting = null },
            onSubmit = { reason -> change({ vm.reportComment(c, reason) }) { reporting = null } },
        )
    }
    deleting?.let { c ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete your comment?") },
            text = { Text("It is removed from the discussion for everyone.") },
            confirmButton = {
                TextButton(onClick = { deleting = null; change({ vm.deleteComment(c) }) }) { Text("Delete", color = Brand.poor) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

/** One text answer: an edited comment or a report reason. */
@Composable
private fun CommentDialog(
    title: String,
    label: String,
    action: String,
    initial: String = "",
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value, { if (it.length <= MAX_COMMENT) value = it },
                label = { Text(label) },
                modifier = Modifier.fillMaxWidth().heightIn(min = 100.dp).semantics { contentDescription = label },
            )
        },
        confirmButton = { Button(enabled = value.isNotBlank(), onClick = { onSubmit(value.trim()) }) { Text(action) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
