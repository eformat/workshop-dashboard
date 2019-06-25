var fs = require('fs');
var path = require('path');
var yaml = require('js-yaml');
var marked = require('marked');
var asciidoctor = require('asciidoctor')();
var _s = require('underscore.string');
var Liquid = require('liquidjs');

var config = require('./config.js');

// Generic functions.

function slug_to_title(slug) {
    return _s.titleize(_s.humanize(path.basename(slug)));
}

function replace_variables(data, variables) {
    variables.forEach((v) => {
        data = data.replace(new RegExp('%'+v.name+'%', 'g'), v.content);
    });

    return data;
}

async function render_liquidjs(data, variables) {
    var engine = new Liquid();

    var params = {};

    variables.forEach((v) => {
        params[v.name] = v.content;
    });

    return await engine.parseAndRender(data, params);
}

// Page navigation.

function pages() {
    // Use provided page index if one exists. Generate all the
    // prev and next links before returning.

    var pages = []

    if (config.pages !== undefined && config.pages.length > 0) {
        let temp_pages = config.pages.slice(0);
        let page = temp_pages.shift();

        while (page !== undefined) {
            if (page.title === undefined) {
                page.title = slug_to_title(page.path);
            }

            if (temp_pages.length > 0) {
                page.next_page = temp_pages[0].path;
                temp_pages[0].prev_page = page.path;
            }

            pages.push(page);
            page = temp_pages.shift();
        }

        return pages;
    }

    // See if the default page is Markdown. If it then we can
    // try and generate the navigation path from page meta data.
    // It is assumed that all pages are Markdown. This is done
    // to provide backward compatibility for when had to use
    // page meta data to specify title and navigation path.

    var pathname = config.default_page;
    var file = path.join(config.content_dir, pathname + '.md');

    if (!fs.existsSync(file)) {
        return [];
    }

    var visited = new Set();

    // Add the default page to the page index.

    var data = fs.readFileSync(file).toString('utf-8');

    var meta = markdown_extract_metadata(data);
    var title = meta.title ? meta.title : slug_to_title(pathname);

    var details = {
      path: pathname,
      title: title,
      prev_page: null,
      next_page: null,
      exit_sign: meta.exit_sign,
      exit_link: meta.exit_link,
    };

    pages.push(details);
    visited.add(pathname);

    // Traverse the pages to find list of all pages.

    while (meta.next_page) {
        if (visited.has(meta.next_page)) {
            return pages;
	}

        pathname = path.join(path.dirname(pathname), meta.next_page);
	file = path.join(config.content_dir, pathname + '.md');

	if (!fs.existsSync(file)) {
	    return pages;
	}

	data = fs.readFileSync(file).toString('utf-8');

	meta = markdown_extract_metadata(data);
	title = meta.title ? meta.title : slug_to_title(pathname);

        pages[pages.length-1].next_page = pathname;

	details = {
	  path: pathname,
	  title: title,
	  prev_page: pages[pages.length-1].path,
	  next_page: null,
          exit_sign: meta.exit_sign,
          exit_link: meta.exit_link,
	};

        pages.push(details);
    }

    return pages;
}

function page_index(pages) {
    var index = {}

    pages.forEach(page => index[page.path] = page);

    return index;
}

// Markdown rendering.

marked.setOptions({
  renderer: new marked.Renderer(),
  pedantic: false,
  gfm: true,
  tables: true,
  breaks: false,
  sanitize: false,
  smartLists: true,
  smartypants: false,
  xhtml: false
});

const markdown_metadata_regex = /^\uFEFF?---([\s\S]*?)---/i;

function markdown_cleanup_field_name(field, use_underscore) {
    const u = use_underscore || false;

    field = field.replace(/\//g, ' ').trim();

    if (u) {
        return _s.underscored(field);
    }
    else {
        return _s.trim(_s.dasherize(field), '-');
    }
}

function markdown_extract_metadata_fields(obj) {
    let fields = {};

    for (let field in obj) {
        if (obj.hasOwnProperty(field)) {
            let name = markdown_cleanup_field_name(field, true);
            fields[name] = ('' + obj[field]).trim();
        }
    }

    return fields;
}

function markdown_extract_metadata(data) {
    var meta = {};

    if (markdown_metadata_regex.test(data)) {
        let meta_array = data.match(markdown_metadata_regex);
        let meta_string = meta_array ? meta_array[1].trim() : '';
        let yaml_object = yaml.safeLoad(meta_string);

        meta = markdown_extract_metadata_fields(yaml_object);
    }

    return meta;
}

function markdown_extract_content(data) {
    return data.replace(markdown_metadata_regex, '').trim();
}

async function markdown_process_page(file, pathname, variables) {
    var data = fs.readFileSync(file).toString('utf-8');

    data = markdown_extract_content(data);

    if (config.template_engine == 'liquid.js') {
        data = await render_liquidjs(data, variables);
    }
    else {
        data = replace_variables(data, variables);
    }

    return marked(data);
}

async function asciidoc_process_page(file, pathname, variables) {
    var data = fs.readFileSync(file).toString('utf-8');

    data = markdown_extract_content(data);

    if (config.template_engine == 'liquid.js') {
        data = await render_liquidjs(data, variables);
    }
    else {
        data = replace_variables(data, variables);
    }

    var doc = asciidoctor.load(data, { safe: 'server' });

    return doc.convert();
}

async function render(pathname, variables) {
    var file = path.join(config.content_dir, pathname + '.md');

    if (fs.existsSync(file)) {
        return await markdown_process_page(file, pathname, variables);
    }

    file = path.join(config.content_dir, pathname + '.adoc');

    if (fs.existsSync(file)) {
        return await asciidoc_process_page(file, pathname, variables);
    }
}

// Exports.

exports.default = {
    pages,
    page_index,
    render,
}

module.exports = exports.default;
