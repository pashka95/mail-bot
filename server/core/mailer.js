import { getMailList, createTransport, addMail, makeMailReaded } from '../../config-services/gmail';
import EventEmitter from 'events';
import fs from 'fs';
import request from 'request';

class Mailer {

	sender: string;
	emailTransporter: Object;
	interval: number;
	events: Object;
	attachLimit: Object;

	init(options: Object) {

		this.sender = options.sender;
		this.interval = options.interval;
		this.events = new EventEmitter;
		this.attachLimit = options.attachLimit;

		this.setDriver(options.driver)
			.then((emailTransporter) => {
				
				this.emailTransporter = emailTransporter;
				
			})
			.catch((err) => {

				console.log(err);
				
			});

	}

	setDriver(driver: string) {

		return new Promise((resolve, reject) => {

			switch (driver) {

				case 'gmail':
					createTransport()
						.then((emailTransporter) => {

							resolve(emailTransporter);

						})
						.catch((err) => {

							reject(err);

						});
					break;

				default:
					reject('Incorrect driver!');

			}
			
		});

	}

	configureMessage(options) {

		let attachments;
		
		(options.attachments) ? attachments = this.parseAttachments(options.attachments) : true;

		const mailOptions = {
			attachments,
			from: options.sender || this.sender,
			to: options.to,
			subject: options.subject || '',
			html: options.message || ''
		};

		return mailOptions;

	}

	send(options) {

		this.isValidAttachments(options.attachments)
			.then(() => {

				let timeout = this.setTimeout(+options.date);

				setTimeout(() => {

					this.emailTransporter.sendMail(this.configureMessage(options), (error, info) => {

						if (error) {

							this.events.emit('error', error);

						} else {

							addMail({

								messageId: info.messageId,
								envelope: info.envelope

							}).then(() => {

								this.events.emit('success');
								
							}).catch((err) => {

								this.events.emit('error', err);
								
							});

						}

					});

				}, timeout);

			})
			.catch(() => {

				this.events.emit('error', 'Incorrect Attachment');

			});


	}

	setTimeout(dateSend) {

		const dateNow = Date.now();
		
		if (dateSend > dateNow) {

			return dateSend - dateNow;

		} else {

			return 0;
			
		}

	}

	parseAttachments(attachments) {

		let arr = [];

		attachments.forEach((attach) => {

			switch (attach.type)  {

				case 'text':

					arr.push(this.parceTextAttach(attach));
					break;

				case 'url':

					arr.push(this.parceUrlAttach(attach));
					break;

				case 'file':

					arr.push(this.parceFileAttach(attach));
					break;

				default:

					console.log('Unresolved type');

			}

		});
		
		return arr;

	}

	start() {
		
		return setInterval(() => {

			getMailList()
				.then((mails) => {

					this.parseMails(mails);

				})
				.catch((err) => {

					console.log(`Some trouble with db: ${err}`);

				});
			
		}, this.interval);

	}

	stop(timerId) {

		clearInterval(timerId);

	}

	parseMails(mails) {

		mails.forEach((mail) => {

			makeMailReaded({ messageId: mail.messageId })
				.then((data) => {

					this.events.emit('message', data);

				});

		});

	}

	setSendedData(options) {

		const date = new Date();

		let d = {

			year: date.getFullYear(),
			month: date.getMonth(),
			days: date.getDate(),
			hours: date.getHours(),
			minutes: date.getMinutes(),
			seconds: date.getSeconds()

		};

		for (let key in options) {

			d[key] = options[key];

		}

		return new Date(d.year, d.month, d.days, d.hours, d.minutes, d.seconds);

	}

	isValidAttachments(attachments) {

		return new Promise((resolve, reject) => {

			if (!(attachments)) resolve();

			let arr = [];

			attachments.forEach((attach) => {

				switch (attach.type) {

					case 'text':

						this.isValidTextAttach(attach) ? arr.push(true) : arr.push(false);
						break;

					case 'file':

						this.isValidFileAttach(attach) ? arr.push(true) : arr.push(false);
						break;

					case 'url':

						this.isValidUrlAttach(attach).then(() => {

							arr.push(true);

						}).catch(() => {

							arr.push(false);

						});

						break;

					default:

						console.log('Incorrect type');
						reject();

				}

			});

			let timerId = setInterval(() => {

				if (arr.length == attachments.length) {

					arr.forEach((a) => {

						if (!(a)) {

							reject();

						}

					});

					resolve();
					clearInterval(timerId);

				}

			}, 5);

		});

	}

	getFormat(str) {

		let arr = str.split('.');

		if (arr.length !== 1) return arr[arr.length - 1];

	}

	isValidTextAttach(attach) {

		const format = this.getFormat(attach.name);
		let maxSize = this.attachLimit[format];

		if (!maxSize) return false;
		
		return Buffer.byteLength(attach.attach, 'utf8') < maxSize;

	}

	isValidFileAttach(attach) {

		let format;

		attach.name ? format = this.getFormat(attach.name) : format = this.getFormat(attach.attach);

		let maxSize = this.attachLimit[format];

		if (!maxSize) return false;

		const stats = fs.statSync(attach.attach);

		return stats['size'] < maxSize;

	}

	isValidUrlAttach(attach) {

		return new Promise((resolve, reject) => {

			const format = this.getFormat(attach.name);
			let maxSize = this.attachLimit[format];

			if (!maxSize) reject();

			let length = 0;

			let res = request({ url: attach.attach });

			res.on('data', (data) => {

				length += data.length;

				if (length > maxSize) {
					
					reject();
					
					res.abort(); // Abort the response (close and cleanup the stream)

				}

			});

			res.on('end', () => {
				
				resolve();

			});

		});

	}

	parceTextAttach(attach) {

		return {

			filename: attach.name,
			content: attach.attach

		};

	}

	parceFileAttach(attach) {

		let params = {

			filename: attach.name,
			path: attach.attach

		};

		if (!(attach.name)) delete params.filename;

		return params;

	}

	parceUrlAttach(attach) {

		return {

			filename: attach.name,
			path: attach.attach

		};

	}

}

export default new Mailer();
