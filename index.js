/* eslint-disable no-console, no-await-in-loop  */
const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

function getNetlifyUrl(url) {
  return axios.get(url, {
    headers: {
      Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`,
    },
  });
}

const run = async () => {
  try {
    const netlifyToken = process.env.NETLIFY_TOKEN;
    // In a PR, github.contex.sha refers to the last merge commit SHA
    // not the *latest commit* of the PR which is what Netlify uses. Instead,
    // have to use github.context.payload.pull_request.head.sha
    // See: https://docs.github.com/en/developers/webhooks-and-events/webhook-events-and-payloads#pull_request
    const isPr = 'pull_request' in github.context.payload;
    const commitSha = isPr ? github.context.payload.pull_request.head.sha : github.context.sha;
    const siteName = core.getInput('site_name');
    if (!netlifyToken) {
      core.setFailed('Please set NETLIFY_TOKEN env variable to your Netlify Personal Access Token secret');
    }

    if (!commitSha) {
      core.setFailed('Could not determine GitHub commit');
    } else {
      console.log('Using SHA', commitSha, isPr ? 'from PR' : '');
    }
    if (!siteName) {
      core.setFailed('Required field `site_name` was not provided');
    }

    const { data: netlifySites } = await getNetlifyUrl(`https://api.netlify.com/api/v1/sites?name=${siteName}`);
    if (!netlifySites || netlifySites.length === 0) {
      core.setFailed(`Could not find Netlify site with the name ${siteName}`);
    }
    const { site_id: siteId } = netlifySites[0];
    core.setOutput('site_id', siteId);

    const { data: netlifyDeployments } = await getNetlifyUrl(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`);

    if (!netlifyDeployments) {
      core.setFailed('Failed to get deployments for site');
    }

    // Most likely, it's the first entry in the response
    // but we correlate it just to be safe
    const commitDeployment = netlifyDeployments.find((d) => d.commit_ref === commitSha);
    if (!commitDeployment) {
      core.setFailed(`Could not find deployment for commit ${commitSha}`);
    }

    let commitBuild;
    while (!commitBuild || !commitBuild.done) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data } = await getNetlifyUrl(`https://api.netlify.com/api/v1/builds/${commitDeployment.build_id}`);
      commitBuild = data;
    }

    console.log('Build done');

    if (commitBuild.error !== null && typeof commitBuild.error === 'string') {
      core.setFailed(commitBuild.error);
    }

    core.setOutput('deploy_id', commitDeployment.id);
    core.setOutput('url', commitDeployment.links.permalink);
  } catch (error) {
    core.setFailed(error.message);
  }
};

run();
