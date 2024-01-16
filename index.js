const Core = require('@actions/core');
const Github = require('@actions/github');
const Slack = require('node-slack');
const { Octokit } = require("@octokit/core");

const DefaultPRApprovedFormat = `Pull request *{ pull_request.title }* was approved by { review.user.login } :heavy_check_mark:`;
const DefaultPRChangesRequestedFormat = `Pull request *{ pull_request.title }* was rejected by { review.user.login } :cry:`;
const DefaultPRReadyForReviewFormat = `:rocket: New PR ready for review! :rocket:\nTitle: *{ pull_request.title }*\nAuthor: { pull_request.user.login }\nURL: { pull_request.html_url }`;

const fillTemplate = (payload, template) => {
    let message = template;
    template.match(/\{(.*?)\}/g).forEach(template => {
        const templateWithoutBrackets = template
            .replace(/^\{\s?/, "")
            .replace(/\s?\}$/, "");

        const keys = templateWithoutBrackets.split(".");

        let value = payload;
        keys.forEach(key => {
            try {
                if (value[key]) {
                    value = value[key];
                }
            } catch (error) {
                console.log(error);
            }
        });
        message = message.replace(template, value);
    });
    return message;
};

const notificationCommentMessage = (config) => {
    return `Notification was sent to the #${config.channel} Slack channel.`;
};

const doNothingTest = async (config, octokit, pr) => {
};

async function alreadySentNotification(config, octokit, pr) {
    const notification_body = notificationCommentMessage(config);
    const comments = await octokit.request('GET /repos/{repo}/issues/{issue_number}/comments/', {
        repo: config.repo_name,
        issue_number: pr.number,
        per_page: 100,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });
    for (let i = 0; i < comments.length; ++i) {
        if (comments[i].body === notification_body) {
            return true;
        }
    }
    return false;
}

const addCommentThatNotificationSent = async (config, octokit, pr) => {
    await octokit.request('POST /repos/{repo}/issues/{issue_number}/comments', {
        repo: config.repo_name,
        issue_number: pr.number,
        body: notificationCommentMessagei(config),
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });
};

try {
    e = process.env;
    config = {
        channel: e.SLACK_CHANNEL,
        hookUrl: e.SLACK_WEBHOOK,
        ignoreDrafts: e.IGNORE_DRAFTS || true,
        pr_approved_format: e.PR_APPROVED_FORMAT || DefaultPRApprovedFormat,
        pr_ready_for_review_format: e.PR_READY_FOR_REVIEW_FORMAT || DefaultPRReadyForReviewFormat,
        pr_rejected_format: e.PR_REJECTED_FORMAT || DefaultPRChangesRequestedFormat,
        username: e.USERNAME || 'ReadyForReviewBot',
        github_token: e.GITHUB_TOKEN,
        repo_name: e.REPO_NAME,
    };

    if (!config.channel) {
        Core.setFailed("Slack channel is not set. Set it with\nenv:\n\tSLACK_CHANNEL: your-channel");
    }
    if (!config.hookUrl) {
        Core.setFailed("SLACK_WEBHOOK is not set. Set it with\nenv:\n\tSLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}\n");
    }

    const octokit = new Octokit({
        auth: config.github_token,
    })

    const payload = Github.context.payload;
    const review = payload.review;
    const pr = payload.pull_request;
    let message;

    // We don't need to check this at all, because we call slack-notify action only after all checks in our CI.
    // Feel free to delete this condition in the future.
    if (!review && !["ready_for_review", "opened", "synchronize", "reopened"].includes(payload.action)) {
        return
    }

    const slack = new Slack(config.hookUrl);

    if (review) {
        if (payload.review.state == "approved") {
            message = fillTemplate(payload, config.pr_approved_format);
        } else if (payload.review.state == "changes_requested") {
            message = fillTemplate(payload, config.pr_rejected_format);
        }
    } else {
        if (pr.draft && config.ignoreDrafts === true) {
            return
        }
        
        const msg = notificationCommentMessage(config);
        await doNothingTest(config, octokit, pr);

        if (await alreadySentNotification(config, octokit, pr)) {
            return
        } else {
            await addCommentThatNotificationSent(config, octokit, pr);
        }

        message = fillTemplate(payload, config.pr_ready_for_review_format);
    }

    slack.send({
        text: message,
        channel: '#' + config.channel,
        username: config.username
    });
} catch (error) {
    Core.setFailed(error.message);
}
